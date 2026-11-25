// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildScrcpyOptions, resolveQualitySelection, usePreviewStore } from './previewStore'
import { fpsOptions, qualityPresets } from '../constants'

const defaults = {
  mode: 'off' as const,
  quality: 'smooth' as const,
  customFps: 30,
  customMaxSize: 640,
  customBitrateMbps: 4,
}

const legacyDefaults = {
  mode: 'off' as const,
  quality: 'smooth',
  fps: 30,
  maxSize: 640,
  bitrateMbps: 4,
}

function savePreferences(state: unknown, version = 3) {
  window.localStorage.setItem('preview-storage', JSON.stringify({ state, version }))
}

function saveUnversionedPreferences(state: unknown) {
  window.localStorage.setItem('preview-storage', JSON.stringify({ state }))
}

function savedPreferences() {
  return JSON.parse(window.localStorage.getItem('preview-storage') ?? '{}')
}

async function hydrateFrom(state: unknown, version = 3) {
  savePreferences(state, version)
  await usePreviewStore.persist.rehydrate()
}

describe('shared preview preferences', () => {
  beforeEach(() => {
    usePreviewStore.setState(defaults)
    window.localStorage.clear()
  })

  it('starts stopped with the smooth preset and offers low frame rates', () => {
    expect(usePreviewStore.getState()).toMatchObject(defaults)
    expect(usePreviewStore.getState()).not.toHaveProperty('autoStart')
    expect(fpsOptions).toEqual([10, 15, 30, 45, 60, 90, 120, 240])
    expect(buildScrcpyOptions(usePreviewStore.getState())).toEqual({
      max_fps: 30,
      max_size: 640,
      bitrate: 4000000,
      min_bitrate: 1400000,
      max_bitrate: 8000000,
      bwe: true,
      audio: false,
      snapshot_interval: 10,
    })
  })

  it('derives active values from presets and keeps custom values independently', () => {
    expect(resolveQualitySelection(usePreviewStore.getState())).toMatchObject({
      fps: 30, maxSize: 640, bitrateMbps: 4,
    })

    usePreviewStore.getState().setQuality('hd')
    expect(usePreviewStore.getState()).toMatchObject({ quality: 'hd' })
    expect(buildScrcpyOptions(usePreviewStore.getState())).toMatchObject({
      max_fps: 60, max_size: 1280, bitrate: 12000000, max_bitrate: 16000000,
    })

    usePreviewStore.getState().setCustomFps(10)
    usePreviewStore.getState().setCustomMaxSize(800)
    usePreviewStore.getState().setCustomBitrateMbps(1)
    expect(usePreviewStore.getState()).toMatchObject({
      quality: 'custom', customFps: 10, customMaxSize: 800, customBitrateMbps: 1,
    })
    expect(buildScrcpyOptions(usePreviewStore.getState())).toMatchObject({
      max_fps: 10, max_size: 800, bitrate: 1000000, min_bitrate: 1000000, max_bitrate: 1000000,
    })

    usePreviewStore.getState().setQuality('ultra')
    usePreviewStore.getState().setQuality('custom')
    expect(usePreviewStore.getState()).toMatchObject({
      quality: 'custom', customFps: 10, customMaxSize: 800, customBitrateMbps: 1,
    })
  })

  it('seeds the custom group from the active preset on the first edit', () => {
    usePreviewStore.getState().setQuality('hd')
    usePreviewStore.getState().setCustomFps(30)
    expect(usePreviewStore.getState()).toMatchObject({
      quality: 'custom', customFps: 30, customMaxSize: 1280, customBitrateMbps: 12,
    })

    usePreviewStore.getState().setQuality('ultra')
    usePreviewStore.getState().setQuality('custom')
    expect(usePreviewStore.getState()).toMatchObject({
      quality: 'custom', customFps: 30, customMaxSize: 1280, customBitrateMbps: 12,
    })
  })

  it('saves the selected mode with the preferences', () => {
    usePreviewStore.getState().setMode('live')
    usePreviewStore.getState().setQuality('ultra')
    expect(usePreviewStore.getState().mode).toBe('live')
    expect(savedPreferences()).toEqual({
      version: 3,
      state: { ...defaults, mode: 'live', quality: 'ultra' },
    })
  })

  it('keeps the other tab quality when only the mode changes', async () => {
    await hydrateFrom(defaults)
    savePreferences({ ...defaults, quality: 'ultra' })

    usePreviewStore.getState().setMode('live')

    expect(savedPreferences()).toEqual({
      version: 3,
      state: { ...defaults, mode: 'live', quality: 'ultra' },
    })
    expect(usePreviewStore.getState()).toMatchObject({ mode: 'live', quality: 'smooth' })
  })

  it('keeps the other tab mode when only the quality changes', async () => {
    await hydrateFrom(defaults)
    savePreferences({ ...defaults, mode: 'live' })

    usePreviewStore.getState().setQuality('ultra')

    expect(savedPreferences()).toEqual({
      version: 3,
      state: { ...defaults, mode: 'live', quality: 'ultra' },
    })
  })

  it('writes the whole custom group when editing from a preset', async () => {
    await hydrateFrom(defaults)
    savePreferences({
      ...defaults, mode: 'live', quality: 'ultra', customFps: 60, customMaxSize: 1920, customBitrateMbps: 20,
    })

    usePreviewStore.getState().setCustomFps(30)

    expect(savedPreferences()).toEqual({
      version: 3,
      state: { ...defaults, mode: 'live', quality: 'custom', customFps: 30 },
    })
  })

  it('writes the whole preset selection as one preference change', async () => {
    await hydrateFrom(defaults)
    savePreferences({ ...defaults, mode: 'live', quality: 'ultra' })

    usePreviewStore.getState().setQuality('hd')

    expect(savedPreferences()).toEqual({
      version: 3,
      state: { ...defaults, mode: 'live', quality: 'hd' },
    })
  })

  it('falls back to the active preferences when the stored payload is unreadable', async () => {
    await hydrateFrom({ ...defaults, quality: 'ultra' })
    window.localStorage.setItem('preview-storage', '{invalid')

    usePreviewStore.getState().setMode('snapshot')

    expect(savedPreferences()).toEqual({
      version: 3,
      state: { ...defaults, mode: 'snapshot', quality: 'ultra' },
    })
  })

  it('keeps the active preferences when the stored envelope has no state', () => {
    usePreviewStore.setState({ quality: 'ultra' })
    window.localStorage.setItem('preview-storage', JSON.stringify({ version: 3 }))

    usePreviewStore.getState().setMode('live')

    expect(savedPreferences().state).toEqual({
      ...defaults, mode: 'live', quality: 'ultra',
    })
  })

  it('keeps the saved mode when the stored version is newer', () => {
    savePreferences({ ...defaults, mode: 'live' }, 4)

    usePreviewStore.getState().setQuality('ultra')

    expect(savedPreferences().state).toEqual({
      ...defaults, mode: 'live', quality: 'ultra',
    })
  })

  it('keeps preference actions working when storage access throws', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    try {
      expect(() => usePreviewStore.getState().setMode('live')).not.toThrow()
      expect(usePreviewStore.getState().mode).toBe('live')
    } finally {
      getItem.mockRestore()
      setItem.mockRestore()
    }
  })

  it('migrates legacy presets to the nearest current preset', async () => {
    const cases = [
      ['power', 'smooth'],
      ['smooth', 'smooth'],
      ['balanced', 'hd'],
      ['crisp', 'hd'],
      ['ultra', 'ultra'],
      ['unexpected', 'smooth'],
    ] as const

    for (const [stored, expected] of cases) {
      savePreferences({ ...legacyDefaults, quality: stored }, 2)
      await usePreviewStore.persist.rehydrate()
      expect(usePreviewStore.getState()).toMatchObject({
        mode: 'off',
        quality: expected,
        customFps: qualityPresets[expected].fps,
        customMaxSize: qualityPresets[expected].maxSize,
        customBitrateMbps: qualityPresets[expected].bitrateMbps,
      })
    }
  })

  it('preserves legacy custom values when migrating', async () => {
    savePreferences({ mode: 'off', quality: 'custom', fps: 90, maxSize: 1000, bitrateMbps: 2.5 }, 2)
    await usePreviewStore.persist.rehydrate()
    expect(usePreviewStore.getState()).toMatchObject({
      mode: 'off', quality: 'custom', customFps: 90, customMaxSize: 1000, customBitrateMbps: 2.5,
    })
  })

  it('sanitizes legacy custom values', async () => {
    savePreferences({ mode: 'off', quality: 'custom', fps: -10, maxSize: 2.5, bitrateMbps: 9000 }, 2)
    await usePreviewStore.persist.rehydrate()
    expect(usePreviewStore.getState()).toMatchObject({ ...defaults, quality: 'custom' })
  })

  it('applies the legacy mode rule when merging over a version 1 payload', async () => {
    await hydrateFrom(defaults)
    savePreferences({ ...legacyDefaults, mode: 'live', autoStart: true }, 1)

    usePreviewStore.getState().setQuality('ultra')

    expect(savedPreferences()).toEqual({
      version: 3,
      state: { ...defaults, mode: 'live', quality: 'ultra' },
    })
  })

  it('restores the saved mode after loading', async () => {
    savePreferences({ ...defaults, mode: 'live' })
    await usePreviewStore.persist.rehydrate()
    expect(usePreviewStore.getState()).toMatchObject({ ...defaults, mode: 'live' })

    savePreferences({ ...defaults, mode: 'snapshot' })
    await usePreviewStore.persist.rehydrate()
    expect(usePreviewStore.getState()).toMatchObject({ ...defaults, mode: 'snapshot' })
  })

  it('falls back to off for an unsupported saved mode', async () => {
    savePreferences({ ...defaults, mode: 'unexpected' })
    await usePreviewStore.persist.rehydrate()
    expect(usePreviewStore.getState()).toMatchObject(defaults)
  })

  it('restores saved custom quality', async () => {
    savePreferences({ ...defaults, quality: 'custom', customFps: 90, customMaxSize: 1000, customBitrateMbps: 2.5 })
    await usePreviewStore.persist.rehydrate()
    expect(usePreviewStore.getState()).toMatchObject({
      quality: 'custom', customFps: 90, customMaxSize: 1000, customBitrateMbps: 2.5,
    })
  })

  it('migrates auto-starting preferences to the saved mode', async () => {
    savePreferences({ ...legacyDefaults, mode: 'snapshot', autoStart: true }, 1)
    await usePreviewStore.persist.rehydrate()
    expect(usePreviewStore.getState()).toMatchObject({ ...defaults, mode: 'snapshot' })
    expect(usePreviewStore.getState()).not.toHaveProperty('autoStart')
    expect(savedPreferences()).toEqual({ version: 3, state: { ...defaults, mode: 'snapshot' } })

    savePreferences({ ...legacyDefaults, mode: 'live', autoStart: true }, 0)
    await usePreviewStore.persist.rehydrate()
    expect(usePreviewStore.getState()).toMatchObject({ ...defaults, mode: 'live' })
  })

  it('clears the saved mode when legacy preferences did not auto-start', async () => {
    savePreferences({ ...legacyDefaults, mode: 'live', autoStart: false }, 1)
    await usePreviewStore.persist.rehydrate()
    expect(usePreviewStore.getState()).toMatchObject(defaults)

    savePreferences({ ...legacyDefaults, mode: 'live', autoStart: 'true' }, 1)
    await usePreviewStore.persist.rehydrate()
    expect(usePreviewStore.getState()).toMatchObject(defaults)

    savePreferences({ ...legacyDefaults, mode: 'live' }, 0)
    await usePreviewStore.persist.rehydrate()
    expect(usePreviewStore.getState()).toMatchObject(defaults)
  })

  it('treats preferences without a stored version as the auto-start format', async () => {
    saveUnversionedPreferences({ ...legacyDefaults, mode: 'live', autoStart: false })
    await usePreviewStore.persist.rehydrate()
    expect(usePreviewStore.getState()).toMatchObject(defaults)

    saveUnversionedPreferences({ ...legacyDefaults, mode: 'snapshot', autoStart: true })
    await usePreviewStore.persist.rehydrate()
    expect(usePreviewStore.getState()).toMatchObject({ ...defaults, mode: 'snapshot' })
  })

  it('sanitizes stale data and does not accept persisted actions', async () => {
    savePreferences({
      mode: 'unexpected', autoStart: 'true', quality: 'custom',
      fps: -10, maxSize: 2.5, bitrateMbps: 9000, setMode: 'overwritten',
    }, 0)
    await usePreviewStore.persist.rehydrate()
    expect(usePreviewStore.getState()).toMatchObject({ ...defaults, quality: 'custom' })
    expect(usePreviewStore.getState().setMode).toBeTypeOf('function')

    savePreferences(['live', 'ultra'])
    await usePreviewStore.persist.rehydrate()
    expect(usePreviewStore.getState()).toMatchObject(defaults)

    savePreferences(['live', 'ultra'], 1)
    await usePreviewStore.persist.rehydrate()
    expect(usePreviewStore.getState()).toMatchObject(defaults)

    savePreferences({ mode: 'live', quality: '__proto__' })
    await usePreviewStore.persist.rehydrate()
    expect(usePreviewStore.getState()).toMatchObject({ ...defaults, mode: 'live' })

    savePreferences({ mode: 'live', autoStart: true, quality: '__proto__' }, 1)
    await usePreviewStore.persist.rehydrate()
    expect(usePreviewStore.getState()).toMatchObject({ ...defaults, mode: 'live' })
  })

  it('ignores invalid custom values and malformed JSON', async () => {
    usePreviewStore.getState().setCustomFps(NaN)
    usePreviewStore.getState().setCustomMaxSize(Infinity)
    usePreviewStore.getState().setCustomBitrateMbps(0)
    expect(usePreviewStore.getState()).toMatchObject(defaults)

    window.localStorage.setItem('preview-storage', '{invalid')
    await usePreviewStore.persist.rehydrate()
    expect(usePreviewStore.getState()).toMatchObject(defaults)
  })
})
