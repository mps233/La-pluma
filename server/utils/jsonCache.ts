import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readJsonFile } from './fileHelper.ts'

interface JsonCacheEntry {
  mtimeMs: number
  size: number
  value: unknown
}

const cache = new Map<string, JsonCacheEntry>()
const inFlight = new Map<string, Promise<unknown>>()

/**
 * Read a JSON file and reuse the parsed value while its mtime/size are
 * unchanged. MaaResource and user data are rewritten rarely, but several
 * request paths used to re-read and re-parse the same 100-700 KB files on
 * every training/statistics request.
 */
export async function readJsonFileCached<T = unknown>(
  filePath: string,
  defaultValue: unknown = null
): Promise<T> {
  const key = resolve(filePath)
  const info = await stat(key).catch(() => null)
  if (!info?.isFile()) return readJsonFile<T>(key, defaultValue)

  const cached = cache.get(key)
  if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
    return cached.value as T
  }

  const pending = inFlight.get(key)
  if (pending) return pending as Promise<T>

  const promise = readJsonFile<T>(key, defaultValue)
    .then(value => {
      cache.set(key, { mtimeMs: info.mtimeMs, size: info.size, value })
      return value
    })
    .finally(() => {
      inFlight.delete(key)
    })
  inFlight.set(key, promise)
  return promise
}

export function clearJsonFileCache(filePath?: string): void {
  if (filePath) cache.delete(resolve(filePath))
  else cache.clear()
}