export const qualityPresets = {
  smooth: { label: '流畅', fps: 30, maxSize: 640, bitrateMbps: 4, maxBitrateMbps: 8 },
  hd: { label: '高清', fps: 60, maxSize: 1280, bitrateMbps: 12, maxBitrateMbps: 16 },
  ultra: { label: '超清', fps: 60, maxSize: 1920, bitrateMbps: 20, maxBitrateMbps: 32 },
} as const

export function maxSizeToShortSide(maxSize: number): number {
  return Math.round(maxSize * 9 / 16)
}

export const fpsOptions = [10, 15, 30, 45, 60, 90, 120, 240] as const

export const SNAPSHOT_INTERVAL_SECONDS = 10

/** 总览设备采样的轮询间隔；失败静默保留上一份样本。 */
export const DEVICE_STATS_POLL_INTERVAL_MS = 5_000

export type QualityPreset = keyof typeof qualityPresets
export type QualitySelection = QualityPreset | 'custom'
