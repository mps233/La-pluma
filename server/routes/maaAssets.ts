import { getErrorMessage } from '../utils/errors.ts';
import { stat } from 'fs/promises';
import { join } from 'path';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getMaaResourceDir } from '../config/paths.ts';
import { getMaaItemAssetMap } from '../services/maaResourceDataService.ts';
import { asyncHandler } from '../utils/apiHelper.ts';
import { createLogger } from '../utils/logger.ts';

const logger = createLogger('MaaAssets');
const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const AVATAR_KEY_PATTERN = /^char_[A-Za-z0-9_]{1,120}$/;

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
}

export function createMaaAssetsRouter({
  resourceDir = getMaaResourceDir,
  loadItemAssetMap = getMaaItemAssetMap,
  routeLogger = logger
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
    res.set('Cache-Control', 'public, max-age=3600');
    return res.sendFile(file);
  }));

  router.get('/avatar/:id', asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
    const id = String(req.params.id || '').trim();
    if (!AVATAR_KEY_PATTERN.test(id)) {
      return res.status(400).json({ error: 'Invalid asset key' });
    }

    const root = typeof resourceDir === 'function' ? await resourceDir() : resourceDir;
    const file = join(root, 'template', 'avatar', `${id}.png`);
    if (!(await isFile(file))) return sendMissingAsset(res);

    res.set('Cache-Control', 'public, max-age=3600');
    return res.sendFile(file);
  }));

  return router;
}

export default createMaaAssetsRouter();
