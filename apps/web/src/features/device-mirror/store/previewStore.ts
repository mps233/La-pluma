import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { qualityPresets, SNAPSHOT_INTERVAL_SECONDS, type QualityPreset, type QualitySelection } from '../constants'

export type PreviewMode = 'off' | 'snapshot' | 'live'

interface PreviewPreferences {
  mode: PreviewMode
  quality: QualitySelection
  customFps: number
  customMaxSize: number
  customBitrateMbps: number
}

interface PreviewState extends PreviewPreferences {
  setMode: (mode: PreviewMode) => void
  setQuality: (quality: QualitySelection) => void
  setCustomFps: (fps: number) => void
  setCustomMaxSize: (maxSize: number) => void
  setCustomBitrateMbps: (bitrateMbps: number) => void
}

const PREVIEW_STORAGE_KEY = 'preview-storage'
const PREVIEW_STORAGE_VERSION = 3

const defaultPreferences: PreviewPreferences = {
  mode: 'off',
  quality: 'smooth',
  customFps: qualityPresets.smooth.fps,
  customMaxSize: qualityPresets.smooth.maxSize,
  customBitrateMbps: qualityPresets.smooth.bitrateMbps,
}

const LEGACY_PRESET_KEYS: Record<string, QualityPreset> = {
  power: 'smooth',
  smooth: 'smooth',
  balanced: 'hd',
  crisp: 'hd',
  ultra: 'ultra',
}

function isPreviewMode(value: unknown): value is PreviewMode {
  return value === 'off' || value === 'snapshot' || value === 'live'
}

function isQualityPreset(value: unknown): value is QualityPreset {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(qualityPresets, value)
}

function isFps(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 240
}

function isMaxSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 8192
}

function isBitrate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 32
}

function resolveStoredQuality(value: unknown, legacy: boolean): QualitySelection {
  if (value === 'custom') return 'custom'
  if (!legacy && isQualityPreset(value)) return value
  if (legacy && typeof value === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_PRESET_KEYS, value)) {
    const mapped = LEGACY_PRESET_KEYS[value]
    if (mapped !== undefined) return mapped
  }
  return defaultPreferences.quality
}

function restorePreferences(persisted: unknown, modeRequiresAutoStart: boolean): PreviewPreferences {
  if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) {
    return { ...defaultPreferences }
  }

  const stored = persisted as Record<string, unknown>
  const legacy = !Object.prototype.hasOwnProperty.call(stored, 'customMaxSize')
  const quality = resolveStoredQuality(stored.quality, legacy)
  const fallback = quality === 'custom'
    ? {
        fps: defaultPreferences.customFps,
        maxSize: defaultPreferences.customMaxSize,
        bitrateMbps: defaultPreferences.customBitrateMbps,
      }
    : qualityPresets[quality]
  const savedMode = isPreviewMode(stored.mode) ? stored.mode : 'off'
  const mode = modeRequiresAutoStart && stored.autoStart !== true ? 'off' : savedMode

  if (!legacy) {
    return {
      mode,
      quality,
      customFps: isFps(stored.customFps) ? stored.customFps : fallback.fps,
      customMaxSize: isMaxSize(stored.customMaxSize) ? stored.customMaxSize : fallback.maxSize,
      customBitrateMbps: isBitrate(stored.customBitrateMbps) ? stored.customBitrateMbps : fallback.bitrateMbps,
    }
  }

  if (quality !== 'custom') {
    return {
      mode,
      quality,
      customFps: qualityPresets[quality].fps,
      customMaxSize: qualityPresets[quality].maxSize,
      customBitrateMbps: qualityPresets[quality].bitrateMbps,
    }
  }

  return {
    mode,
    quality,
    customFps: isFps(stored.fps) ? stored.fps : fallback.fps,
    customMaxSize: isMaxSize(stored.maxSize) ? stored.maxSize : fallback.maxSize,
    customBitrateMbps: isBitrate(stored.bitrateMbps) ? stored.bitrateMbps : fallback.bitrateMbps,
  }
}

function hasLegacyAutoStart(persisted: unknown): boolean {
  return !!persisted && typeof persisted === 'object' && Object.prototype.hasOwnProperty.call(persisted, 'autoStart')
}

/** 多标签页只在刷新后收敛：写入按本次动作涉及的字段合并最新落盘值（issue #133）。 */
let pendingPreferenceKeys: string[] | null = null

function readStorageItem(name: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(name)
  } catch {
    // 隐私模式或存储被策略拦截时按不可用处理。
    return null
  }
}

function writeStorageItem(name: string, value: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(name, value)
  } catch {
    // 存储不可用时只保留内存中的偏好，偏好动作本身不能失败。
  }
}

function removeStorageItem(name: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(name)
  } catch {
    // 存储不可用时无需清理。
  }
}

function readPersistedPreferences(): PreviewPreferences | null {
  const raw = readStorageItem(PREVIEW_STORAGE_KEY)
  if (!raw) return null
  try {
    const envelope: unknown = JSON.parse(raw)
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return null
    const { state, version } = envelope as { state?: unknown; version?: unknown }
    if (!state || typeof state !== 'object' || Array.isArray(state)) return null
    const legacyMode = typeof version === 'number' ? version < 2 : true
    return restorePreferences(state, legacyMode || hasLegacyAutoStart(state))
  } catch {
    return null
  }
}

function mergePersistedPreferences(next: unknown, changedKeys: string[] | null): PreviewPreferences {
  const latest = readPersistedPreferences()
  if (!latest) return restorePreferences(next, false)

  const nextRecord = next && typeof next === 'object' && !Array.isArray(next)
    ? next as Record<string, unknown>
    : {}
  const merged: Record<string, unknown> = { ...latest }
  for (const key of changedKeys ?? Object.keys(nextRecord)) {
    if (Object.prototype.hasOwnProperty.call(nextRecord, key)) merged[key] = nextRecord[key]
  }
  return restorePreferences(merged, false)
}

const previewStorage: StateStorage = {
  getItem: (name) => readStorageItem(name),
  setItem: (name, value) => {
    try {
      const envelope: unknown = JSON.parse(value)
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
        writeStorageItem(name, value)
        return
      }
      const { state, ...rest } = envelope as { state?: unknown }
      const merged = mergePersistedPreferences(state, pendingPreferenceKeys)
      writeStorageItem(name, JSON.stringify({ ...rest, state: merged }))
    } catch {
      writeStorageItem(name, value)
    }
  },
  removeItem: (name) => removeStorageItem(name),
}

type QualityPreferences = Pick<PreviewPreferences, 'quality' | 'customFps' | 'customMaxSize' | 'customBitrateMbps'>

export function resolveQualitySelection(preferences: QualityPreferences) {
  if (preferences.quality === 'custom') {
    return {
      fps: preferences.customFps,
      maxSize: preferences.customMaxSize,
      bitrateMbps: preferences.customBitrateMbps,
    }
  }
  return qualityPresets[preferences.quality]
}

export function buildScrcpyOptions(preferences: QualityPreferences) {
  const { fps, maxSize, bitrateMbps } = resolveQualitySelection(preferences)
  const bitrate = Math.round(bitrateMbps * 1000000)
  const preset = preferences.quality === 'custom' ? null : qualityPresets[preferences.quality]

  return {
    max_fps: fps,
    max_size: maxSize,
    bitrate,
    min_bitrate: Math.min(bitrate, Math.max(1000000, Math.round(bitrate * 0.35))),
    max_bitrate: Math.round(Math.max(bitrateMbps, preset?.maxBitrateMbps ?? bitrateMbps) * 1000000),
    bwe: true,
    audio: false,
    snapshot_interval: SNAPSHOT_INTERVAL_SECONDS,
  }
}

export const usePreviewStore = create<PreviewState>()(
  persist(
    (set, get) => {
      const commit = (partial: Partial<PreviewPreferences>) => {
        pendingPreferenceKeys = Object.keys(partial)
        try {
          set(partial)
        } finally {
          pendingPreferenceKeys = null
        }
      }

      const updateCustom = (patch: Partial<QualityPreferences>) => {
        const state = get()
        if (state.quality === 'custom') {
          commit(patch)
          return
        }
        const active = resolveQualitySelection(state)
        commit({
          quality: 'custom',
          customFps: active.fps,
          customMaxSize: active.maxSize,
          customBitrateMbps: active.bitrateMbps,
          ...patch,
        })
      }

      return {
        ...defaultPreferences,
        setMode: (mode) => commit({ mode }),
        setQuality: (quality) => commit({ quality }),
        setCustomFps: (fps) => {
          if (isFps(fps)) updateCustom({ customFps: fps })
        },
        setCustomMaxSize: (maxSize) => {
          if (isMaxSize(maxSize)) updateCustom({ customMaxSize: maxSize })
        },
        setCustomBitrateMbps: (bitrateMbps) => {
          if (isBitrate(bitrateMbps)) updateCustom({ customBitrateMbps: bitrateMbps })
        },
      }
    },
    {
      name: PREVIEW_STORAGE_KEY,
      storage: createJSONStorage(() => previewStorage),
      version: PREVIEW_STORAGE_VERSION,
      partialize: ({ mode, quality, customFps, customMaxSize, customBitrateMbps }) => ({
        mode, quality, customFps, customMaxSize, customBitrateMbps,
      }),
      migrate: (persistedState, version) => restorePreferences(persistedState, version < 2),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...restorePreferences(persistedState, hasLegacyAutoStart(persistedState)),
      }),
    },
  ),
)
