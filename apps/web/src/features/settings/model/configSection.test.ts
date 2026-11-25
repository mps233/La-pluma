// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import {
  CONFIG_SECTION_EVENT,
  CONFIG_SECTION_STORAGE_KEY,
  isConfigSectionId,
  subscribeConfigSection,
  writeConfigSection,
} from './configSection'

const createStorage = () => {
  const values = new Map<string, string>()
  return {
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    values,
  }
}

describe('config section compatibility', () => {
  it('keeps the existing storage key and window event names', () => {
    expect(CONFIG_SECTION_STORAGE_KEY).toBe('laPlumaConfigSection')
    expect(CONFIG_SECTION_EVENT).toBe('la-pluma-config-section')
  })

  it('persists the active section without propagating storage failures', () => {
    const storage = createStorage()
    writeConfigSection('instance', storage)
    expect(storage.values.get(CONFIG_SECTION_STORAGE_KEY)).toBe('instance')

    expect(() => writeConfigSection('resource', {
      setItem: () => {
        throw new Error('storage unavailable')
      },
    })).not.toThrow()
  })

  it('keeps only connection editable', () => {
    expect(isConfigSectionId('connection')).toBe(true)
    expect(isConfigSectionId('resource')).toBe(true)
    expect(isConfigSectionId('instance')).toBe(true)
    expect(isConfigSectionId('updates')).toBe(false)
  })

  it('subscribes to valid section events and unsubscribes cleanly', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeConfigSection(listener)

    window.dispatchEvent(new CustomEvent(CONFIG_SECTION_EVENT, { detail: 'resource' }))
    expect(listener).toHaveBeenCalledWith('resource')

    window.dispatchEvent(new CustomEvent(CONFIG_SECTION_EVENT, { detail: 'unknown' }))
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    window.dispatchEvent(new CustomEvent(CONFIG_SECTION_EVENT, { detail: 'instance' }))
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
