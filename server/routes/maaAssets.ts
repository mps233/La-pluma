import { getErrorMessage } from '../utils/errors.ts';
import { createHash } from 'crypto';
import { mkdir, rename, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getMaaResourceDir } from '../config/paths.ts';
import { getMaaItemAssetMap } from '../services/maaResourceDataService.ts';
import { asyncHandler } from '../utils/apiHelper.ts';
import { createLogger } from '../utils/logger.ts';

const logger = createLogger('MaaAssets');
const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const AVATAR_KEY_PATTERN = /^char_[A-Za-z0-9_]{1,120}$/;
const DEFAULT_ASSET_CACHE_DIR = join(tmpdir(), 'la-pluma-asset-cache');
const webpConversions = new Map<string, Promise<string | null>>();
const WEBP_CONCURRENCY = (() => {
  const value = Number(process.env.LA_PLUMA_ASSET_WEBP_CONCURRENCY || 4);
  return Number.isFinite(value) && value > 0 ? Math.min(16, Math.trunc(value)) : 4;
})();
let activeWebpConversions = 0;
const webpQueue: Array<() => void> = [];

async function withWebpSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeWebpConversions >= WEBP_CONCURRENCY) {
    await new Promise<void>(resolve => webpQueue.push(resolve));
  }
  activeWebpConversions += 1;
  try {
    return await task();
  } finally {
    activeWebpConversions -= 1;
    webpQueue.shift()?.();
  }
}

export function normalizeMaaAssetKey(value: unknown): string | null {
  const key = String(value || '').trim().replace(/\.png$/i, '');
  return ASSET_KEY_PATTERN.test(key) ? key : null;
}

export function selectMaaItemAssetId(key: unknown, assetMap: unknown): string | null {
  const normalized = normalizeMaaAssetKey(key);
  if (!normalized) return null;
  if (!(assetMap instanceof Map)) return normalized;
  return assetMap.get(normalized) || normalized;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function sendMissingAsset(res: Response) {
  return res.status(404).json({ error: 'Not Found' });
}

/**
 * The client appends an asset version after a MaaResource update. Versioned
 * URLs can be cached for a year; unversioned URLs keep a short cache so an
 * in-place resource update is still picked up.
 */
function setAssetCacheHeaders(req: Request, res: Response) {
  const versioned = typeof req.query.v === 'string' && req.query.v.length > 0;
  res.set('Vary', 'Accept');
  res.set('Cache-Control', versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=86400');
}

function acceptsWebp(req: Request): boolean {
  return /\bimage\/webp\b/i.test(String(req.headers.accept || ''));
}

async function getWebpVariant(sourcePath: string, sourceInfo: { mtimeMs: number; size: number }, cacheDir: string): Promise<string | null> {
  const key = createHash('sha256')
    .update(`${sourcePath}\u0000${sourceInfo.mtimeMs}\u0000${sourceInfo.size}`)
    .digest('hex');
  const targetPath = join(cacheDir, `${key}.webp`);

  if (await isFile(targetPath)) return targetPath;
  const pending = webpConversions.get(targetPath);
  if (pending) return pending;

  const conversion = withWebpSlot(async () => {
    await mkdir(cacheDir, { recursive: true });
    const buffer = await sharp(sourcePath)
      .webp({ quality: 82, effort: 4 })
      .toBuffer();
    const tempPath = `${targetPath}.${process.pid}.tmp`;
    await writeFile(tempPath, buffer);
    await rename(tempPath, targetPath);
    return targetPath;
  }).catch(error => {
    logger.warn('MaaResource 图像转换 WebP 失败', {
      sourcePath,
      error: getErrorMessage(error)
    });
    return null;
  }).finally(() => {
    webpConversions.delete(targetPath);
  });

  webpConversions.set(targetPath, conversion);
  return conversion;
}

async function sendAsset(req: Request, res: Response, file: string, cacheDir: string) {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return sendMissingAsset(res);

  setAssetCacheHeaders(req, res);
  if (acceptsWebp(req)) {
    const webp = await getWebpVariant(file, info, cacheDir);
    if (webp) {
      res.type('image/webp');
      return res.sendFile(webp);
    }
  }
  return res.sendFile(file);
}

/**
 * Serve read-only MaaResource images for the UI.
 *
 * The route is mounted before the optional `/api` auth middleware because
 * `<img>` requests cannot attach the bearer header used by the JSON API. The
 * keys are restricted to the template asset namespace; no other resource files
 * are exposed.
 */
interface MaaAssetsRouterOptions {
  resourceDir?: (() => string | Promise<string>) | string;
  loadItemAssetMap?: typeof getMaaItemAssetMap;
  routeLogger?: ReturnType<typeof createLogger>;
  assetCacheDir?: string;
}

export function createMaaAssetsRouter({
  resourceDir = getMaaResourceDir,
  loadItemAssetMap = getMaaItemAssetMap,
  routeLogger = logger,
  assetCacheDir = process.env.LA_PLUMA_ASSET_CACHE_DIR?.trim() || DEFAULT_ASSET_CACHE_DIR
}: MaaAssetsRouterOptions = {}) {
  const router = Router();

  router.get('/item/:key', asyncHandler(async (req: Request<{ key: string }>, res: Response) => {
    const key = normalizeMaaAssetKey(req.params.key);
    if (!key) return res.status(400).json({ error: 'Invalid asset key' });

    const root = typeof resourceDir === 'function' ? await resourceDir() : resourceDir;
    const itemsDir = join(root, 'template', 'items');
    let file = join(itemsDir, `${key}.png`);

    if (!(await isFile(file))) {
      try {
        const assetMap = await loadItemAssetMap();
        const itemId = selectMaaItemAssetId(key, assetMap);
        if (!itemId) return sendMissingAsset(res);
        file = join(itemsDir, `${itemId}.png`);
      } catch (error) {
        routeLogger.warn('解析 MaaResource 物品图标失败', {
          key,
          error: getErrorMessage(error)
        });
        return sendMissingAsset(res);
      }
    }

    if (!(await isFile(file))) return sendMissingAsset(res);
    return sendAsset(req, res, file, assetCacheDir);
  }));

  router.get('/avatar/:id', asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
    const id = String(req.params.id || '').trim();
    if (!AVATAR_KEY_PATTERN.test(id)) {
      return res.status(400).json({ error: 'Invalid asset key' });
    }

    const root = typeof resourceDir === 'function' ? await resourceDir() : resourceDir;
    const file = join(root, 'template', 'avatar', `${id}.png`);
    if (!(await isFile(file))) return sendMissingAsset(res);
    return sendAsset(req, res, file, assetCacheDir);
  }));

  return router;
}

export default createMaaAssetsRouter();
