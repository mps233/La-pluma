// @vitest-environment jsdom

import { cleanup, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useOnlineStatus } from './useOnlineStatus'

let online = true

describe('useOnlineStatus', () => {
  beforeEach(() => {
    online = true
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => online,
    })
  })

  afterEach(cleanup)

  it('tracks browser offline and online events', () => {
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(true)

    online = false
    fireEvent(window, new Event('offline'))
    expect(result.current).toBe(false)

    online = true
    fireEvent(window, new Event('online'))
    expect(result.current).toBe(true)
  })
})
