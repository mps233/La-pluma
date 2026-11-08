// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import {
  ACCESS_TOKEN_STORAGE_KEY,
  TOKEN_CHANGED_EVENT,
  clearAccessToken,
  readAccessToken,
  writeAccessToken,
} from './accessToken'

describe('accessToken', () => {
  it('normalizes Bearer prefixes and rejects control characters', () => {
    expect(writeAccessToken('  Bearer secret-token  ')).toBe('secret-token')
    expect(readAccessToken()).toBe('secret-token')

    expect(writeAccessToken('bad\u0000token')).toBe('')
    expect(readAccessToken()).toBe('')
  })

  it('clears the stored token and emits a change event', () => {
    const changed = vi.fn()
    window.addEventListener(TOKEN_CHANGED_EVENT, changed)
    writeAccessToken('secret-token')
    clearAccessToken()
    window.removeEventListener(TOKEN_CHANGED_EVENT, changed)

    expect(localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBeNull()
    expect(changed).toHaveBeenCalled()
  })
})