import { afterEach, describe, expect, it } from 'vitest'
import {
  buildPreviewScrcpyOptions,
  previewQualityPresets,
  usePreviewStore,
} from './previewStore'

const defaults = {
  mode: 'off' as const,
  autoStart: false,
  quality: 'power' as const,
  ...previewQualityPresets.power,
}

afterEach(() => {
  usePreviewStore.setState(defaults)
})

describe('previewStore', () => {
  it('defaults to off with the power preset', () => {
    const state = usePreviewStore.getState()
    expect(state.mode).toBe('off')
    expect(state.autoStart).toBe(false)
    expect(state.quality).toBe('power')
    expect(state.fps).toBe(15)
    expect(state.maxSize).toBe(640)
  })

  it('applies quality presets and custom values', () => {
    usePreviewStore.getState().setQuality('balanced')
    expect(usePreviewStore.getState()).toMatchObject({
      quality: 'balanced',
      fps: 45,
      maxSize: 1280,
      bitrateMbps: 8,
    })

    usePreviewStore.getState().setCustomFps(24)
    expect(usePreviewStore.getState()).toMatchObject({ quality: 'custom', fps: 24 })

    usePreviewStore.getState().setCustomFps(999)
    expect(usePreviewStore.getState().fps).toBe(24)
  })

  it('builds scrcpy options with the selected bitrate bounds', () => {
    const options = buildPreviewScrcpyOptions({
      quality: 'power',
      fps: 15,
      maxSize: 640,
      bitrateMbps: 1.5,
    })
    expect(options).toMatchObject({
      max_fps: 15,
      max_size: 640,
      bitrate: 1_500_000,
      max_bitrate: 3_000_000,
      snapshot_interval: 10,
      audio: false,
    })
  })
})
