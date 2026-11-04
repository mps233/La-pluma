/**
 * Preview Store - 模拟器预览模式、画质与恢复偏好。
 *
 * 模式只在本次应用会话内保留；只有显式开启“重新打开时恢复预览”才会在
 * 刷新后恢复上次模式。默认关闭，避免打开页面就启动实时编码与设备 Agent。
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type PreviewMode = 'off' | 'snapshot' | 'live'

export const previewQualityPresets = {
  power: { label: '省电', fps: 15, maxSize: 640, bitrateMbps: 1.5, maxBitrateMbps: 3 },
  smooth: { label: '流畅', fps: 30, maxSize: 960, bitrateMbps: 4, maxBitrateMbps: 8 },
  balanced: { label: '均衡', fps: 45, maxSize: 1280, bitrateMbps: 8, maxBitrateMbps: 16 },
  crisp: { label: '清晰', fps: 60, maxSize: 1600, bitrateMbps: 14, maxBitrateMbps: 24 },
  ultra: { label: '超清', fps: 60, maxSize: 1920, bitrateMbps: 20, maxBitrateMbps: 32 },
} as const

export type PreviewQualityPreset = keyof typeof previewQualityPresets
export type PreviewQuality = PreviewQualityPreset | 'custom'

interface PreviewPreferences {
  mode: PreviewMode
  autoStart: boolean
  quality: PreviewQuality
  fps: number
  maxSize: number
  bitrateMbps: number
}

interface PreviewState extends PreviewPreferences {
  setMode: (mode: PreviewMode) => void
  setAutoStart: (autoStart: boolean) => void
  setQuality: (quality: PreviewQuality) => void
  setCustomFps: (fps: number) => void
  setCustomMaxSize: (maxSize: number) => void
  setCustomBitrateMbps: (bitrateMbps: number) => void
}

const DEFAULT_PREFERENCES: PreviewPreferences = {
  mode: 'off',
  autoStart: false,
  quality: 'power',
  ...previewQualityPresets.power,
}

function isPreviewMode(value: unknown): value is PreviewMode {
  return value === 'off' || value === 'snapshot' || value === 'live'
}

function isQualityPreset(value: unknown): value is PreviewQualityPreset {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(previewQualityPresets, value)
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function restorePreferences(persisted: unknown): PreviewPreferences {
  if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) {
    return { ...DEFAULT_PREFERENCES }
  }

  const stored = persisted as Record<string, unknown>
  const autoStart = stored.autoStart === true
  const quality = stored.quality === 'custom' || isQualityPreset(stored.quality)
    ? stored.quality
    : DEFAULT_PREFERENCES.quality
  const preset = quality === 'custom' ? DEFAULT_PREFERENCES : previewQualityPresets[quality]

  return {
    autoStart,
    mode: autoStart && isPreviewMode(stored.mode) ? stored.mode : 'off',
    quality,
    fps: quality === 'custom' && isIntegerInRange(stored.fps, 1, 120) ? stored.fps : preset.fps,
    maxSize: quality === 'custom' && isIntegerInRange(stored.maxSize, 1, 8192) ? stored.maxSize : preset.maxSize,
    bitrateMbps: quality === 'custom'
      && typeof stored.bitrateMbps === 'number'
      && Number.isFinite(stored.bitrateMbps)
      && stored.bitrateMbps >= 1
      && stored.bitrateMbps <= 32
      ? stored.bitrateMbps
      : preset.bitrateMbps,
  }
}

export function buildPreviewScrcpyOptions({
  quality,
  fps,
  maxSize,
  bitrateMbps,
}: Pick<PreviewPreferences, 'quality' | 'fps' | 'maxSize' | 'bitrateMbps'>) {
  const preset = quality === 'custom' ? null : previewQualityPresets[quality]
  const bitrate = Math.round(bitrateMbps * 1_000_000)
  return {
    max_fps: fps,
    max_size: maxSize,
    bitrate,
    min_bitrate: Math.min(bitrate, Math.max(1_000_000, Math.round(bitrate * 0.35))),
    max_bitrate: Math.round(Math.max(bitrateMbps, preset?.maxBitrateMbps ?? bitrateMbps) * 1_000_000),
    bwe: true,
    audio: false,
    snapshot_interval: 10,
    stay_awake: true,
  }
}

export const usePreviewStore = create<PreviewState>()(
  persist(
    (set) => ({
      ...DEFAULT_PREFERENCES,

      setMode: (mode) => set({ mode }),
      setAutoStart: (autoStart) => set({ autoStart }),
      setQuality: (quality) => {
        if (quality === 'custom') {
          set({ quality })
          return
        }
        set({ quality, ...previewQualityPresets[quality] })
      },
      setCustomFps: (fps) => {
        if (isIntegerInRange(fps, 1, 120)) set({ quality: 'custom', fps })
      },
      setCustomMaxSize: (maxSize) => {
        if (isIntegerInRange(maxSize, 1, 8192)) set({ quality: 'custom', maxSize })
      },
      setCustomBitrateMbps: (bitrateMbps) => {
        if (Number.isFinite(bitrateMbps) && bitrateMbps >= 1 && bitrateMbps <= 32) {
          set({ quality: 'custom', bitrateMbps })
        }
      },
    }),
    {
      name: 'preview-storage',
      version: 1,
      partialize: ({ mode, autoStart, quality, fps, maxSize, bitrateMbps }) => ({
        mode, autoStart, quality, fps, maxSize, bitrateMbps,
      }),
      merge: (persisted, current) => ({
        ...current,
        ...restorePreferences(persisted),
      }),
    }
  )
)
