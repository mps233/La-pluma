import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { createWorker, PSM, type Worker } from 'tesseract.js';
import { captureScreen } from './maaService.ts';
import type { ResolvedConnection } from './connectionService.ts';

export interface BattleProgress {
  kills: number;
  total: number;
}

const CROP = { x: 540, y: 14, width: 86, height: 34 };
const CROP_REFERENCE = { width: 1280, height: 720 };
const DEFAULT_SCALE = 3;
const MIN_SCALE = 2;
const MAX_SCALE = 6;
const PADDING = 20;
const THRESHOLD = 120;
const MAX_TOTAL = 500;
const DEFAULT_INTERVAL_MS = 5_000;
const MIN_INTERVAL_MS = 2_000;
const MAX_INTERVAL_MS = 60_000;
const DEFAULT_WORKER_IDLE_TIMEOUT_MS = 2 * 60 * 1000;
const OCR_CACHE_DIR = join(tmpdir(), 'la-pluma-battle-ocr');

let workerPromise: Promise<Worker> | null = null;
let workerIdleTimer: ReturnType<typeof setTimeout> | null = null;
let activeRecognitions = 0;

export function isBattleOcrEnabled(): boolean {
  const value = String(process.env.LA_PLUMA_BATTLE_OCR ?? '1').trim().toLowerCase();
  return value !== '0' && value !== 'false' && value !== 'off';
}

export function getBattleOcrScale(): number {
  const value = Number(process.env.LA_PLUMA_BATTLE_OCR_SCALE || DEFAULT_SCALE);
  if (!Number.isFinite(value)) return DEFAULT_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(value)));
}

function getWorkerIdleTimeoutMs(): number {
  const value = Number(process.env.LA_PLUMA_BATTLE_OCR_IDLE_MS || DEFAULT_WORKER_IDLE_TIMEOUT_MS);
  if (!Number.isFinite(value) || value < 0) return DEFAULT_WORKER_IDLE_TIMEOUT_MS;
  return Math.trunc(value);
}

export function getBattleOcrIntervalMs(): number {
  const value = Number(process.env.LA_PLUMA_BATTLE_OCR_INTERVAL_MS || DEFAULT_INTERVAL_MS);
  if (!Number.isFinite(value)) return DEFAULT_INTERVAL_MS;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(value)));
}

/**
 * Parse the counter OCR text. Tesseract may read the zero as O/o/О; normalize
 * before matching. Reject values that cannot be a battle counter.
 */
export function parseBattleCounter(text: string): BattleProgress | null {
  const normalized = String(text || '')
    .replace(/[OoОо]/g, '0')
    .replace(/\s+/g, '');
  const match = normalized.match(/(\d{1,4})\/(\d{1,4})/);
  if (!match) return null;

  const kills = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isInteger(kills) || !Number.isInteger(total)) return null;
  if (total <= 0 || total > MAX_TOTAL || kills < 0 || kills > total) return null;
  return { kills, total };
}

export function preprocessBattleFrame(frame: Buffer): Buffer | null {
  let source: PNG;
  try {
    source = PNG.sync.read(frame);
  } catch {
    return null;
  }

  const scaleX = source.width / CROP_REFERENCE.width;
  const scaleY = source.height / CROP_REFERENCE.height;
  const cropX = Math.max(0, Math.round(CROP.x * scaleX));
  const cropY = Math.max(0, Math.round(CROP.y * scaleY));
  const cropWidth = Math.max(1, Math.round(CROP.width * scaleX));
  const cropHeight = Math.max(1, Math.round(CROP.height * scaleY));
  const pixelScale = getBattleOcrScale();
  const outWidth = cropWidth * pixelScale;
  const outHeight = cropHeight * pixelScale;
  const out = new PNG({ width: outWidth + PADDING * 2, height: outHeight + PADDING * 2 });
  out.data.fill(255);

  for (let y = 0; y < outHeight; y += 1) {
    const sourceY = cropY + Math.floor(y / pixelScale);
    if (sourceY >= source.height) break;
    for (let x = 0; x < outWidth; x += 1) {
      const sourceX = cropX + Math.floor(x / pixelScale);
      if (sourceX >= source.width) break;
      const sourceIndex = (sourceY * source.width + sourceX) * 4;
      const gray = 0.299 * source.data[sourceIndex]
        + 0.587 * source.data[sourceIndex + 1]
        + 0.114 * source.data[sourceIndex + 2];
      const value = gray > THRESHOLD ? 0 : 255;
      const outIndex = ((y + PADDING) * out.width + (x + PADDING)) * 4;
      out.data[outIndex] = value;
      out.data[outIndex + 1] = value;
      out.data[outIndex + 2] = value;
      out.data[outIndex + 3] = 255;
    }
  }

  return PNG.sync.write(out);
}

export async function captureBattleFrame(connection: ResolvedConnection): Promise<Buffer> {
  const { image } = await captureScreen(connection.adbPath, connection.address);
  return Buffer.from(image, 'base64');
}

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      mkdirSync(OCR_CACHE_DIR, { recursive: true });
      const worker = await createWorker('eng', 1, {
        cachePath: OCR_CACHE_DIR,
        logger: () => undefined
      });
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789/',
        tessedit_pageseg_mode: PSM.SINGLE_LINE
      });
      return worker;
    })().catch(error => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

function scheduleWorkerIdleShutdown() {
  if (workerIdleTimer) {
    clearTimeout(workerIdleTimer);
    workerIdleTimer = null;
  }
  const timeout = getWorkerIdleTimeoutMs();
  if (!workerPromise || timeout <= 0) return;
  workerIdleTimer = setTimeout(() => {
    workerIdleTimer = null;
    if (activeRecognitions === 0) void shutdownBattleOcr();
  }, timeout);
  workerIdleTimer.unref?.();
}

export async function recognizeBattleProgress(
  frame: Buffer,
  expectedTotal: number | null = null
): Promise<BattleProgress | null> {
  const processed = preprocessBattleFrame(frame);
  if (!processed) return null;

  const worker = await getWorker();
  activeRecognitions += 1;
  try {
    const { data } = await worker.recognize(processed);
    if (Number(data.confidence) < 55) return null;

    const battle = parseBattleCounter(data.text);
    if (!battle) return null;
    if (expectedTotal !== null && battle.total !== expectedTotal) return null;
    return battle;
  } finally {
    activeRecognitions = Math.max(0, activeRecognitions - 1);
    if (activeRecognitions === 0) scheduleWorkerIdleShutdown();
  }
}

export async function readBattleProgress(
  connection: ResolvedConnection,
  expectedTotal: number | null = null
): Promise<BattleProgress | null> {
  if (!isBattleOcrEnabled()) return null;
  const frame = await captureBattleFrame(connection);
  return recognizeBattleProgress(frame, expectedTotal);
}

export async function shutdownBattleOcr(): Promise<void> {
  if (workerIdleTimer) {
    clearTimeout(workerIdleTimer);
    workerIdleTimer = null;
  }
  if (!workerPromise) return;
  const worker = await workerPromise.catch(() => null);
  workerPromise = null;
  await worker?.terminate().catch(() => undefined);
}
