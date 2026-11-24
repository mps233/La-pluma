// @vitest-environment jsdom

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useResolvedTheme } from './useResolvedTheme'
import { useUIStore } from '@/stores'

type Listener = (event: { matches: boolean }) => void

function mockMatchMedia(initialDark: boolean) {
  const listeners = new Set<Listener>()
  let dark = initialDark
  const query = {
    get matches() { return dark },
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, cb: Listener) => { listeners.add(cb) },
    removeEventListener: (_: string, cb: Listener) => { listeners.delete(cb) },
  }
  vi.stubGlobal('matchMedia', vi.fn(() => query))
  return {
    setDark(next: boolean) {
      dark = next
      listeners.forEach(cb => cb({ matches: next }))
    },
  }
}

describe('useResolvedTheme', () => {
  beforeEach(() => {
    useUIStore.setState({ theme: 'dark' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('follows an explicit dark preference', () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useResolvedTheme())
    expect(result.current).toBe('dark')
  })

  it('follows an explicit light preference even when the system is dark', () => {
    mockMatchMedia(true)
    useUIStore.setState({ theme: 'light' })
    const { result } = renderHook(() => useResolvedTheme())
    expect(result.current).toBe('light')
  })

  it('resolves system preference to the current system scheme', () => {
    mockMatchMedia(true)
    useUIStore.setState({ theme: 'system' })
    const { result } = renderHook(() => useResolvedTheme())
    expect(result.current).toBe('dark')
  })

  it('updates when the system scheme changes while following it', () => {
    const media = mockMatchMedia(false)
    useUIStore.setState({ theme: 'system' })
    const { result } = renderHook(() => useResolvedTheme())
    expect(result.current).toBe('light')

    act(() => media.setDark(true))
    expect(result.current).toBe('dark')
  })

  it('ignores system changes when an explicit preference is set', () => {
    const media = mockMatchMedia(false)
    useUIStore.setState({ theme: 'light' })
    const { result } = renderHook(() => useResolvedTheme())

    act(() => media.setDark(true))
    expect(result.current).toBe('light')
  })
})
