// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appTabFromPath, appTabPath, applyThemePreference, useUIStore } from './uiStore'

type ThemeWindow = Window & { __LA_PLUMA_APPLY_THEME__?: (theme: 'light' | 'dark' | 'system') => void }

describe('UI navigation and theme state', () => {
  let systemDark = false

  beforeEach(() => {
    window.localStorage.clear()
    delete (window as ThemeWindow).__LA_PLUMA_APPLY_THEME__
    systemDark = false
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' && systemDark,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    document.head.innerHTML = [
      '<meta name="theme-color" media="(prefers-color-scheme: light)" content="">',
      '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="">',
      '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
    ].join('')
    document.documentElement.classList.remove('dark')
    document.documentElement.style.colorScheme = ''
    document.documentElement.style.removeProperty('--app-bg')
    delete document.documentElement.dataset.theme
  })

  it('maps supported application URLs without persisting navigation state', () => {
    expect(appTabFromPath('/app/dashboard')).toBe('dashboard')
    expect(appTabFromPath('/app/logs/details')).toBe('logs')
    expect(appTabFromPath('/app/not-a-tab')).toBeNull()
    expect(appTabPath('automation')).toBe('/app/automation')

    useUIStore.getState().setActiveTab('logs')
    const persisted = JSON.parse(window.localStorage.getItem('ui-storage') ?? '{}')
    expect(persisted.state).toEqual({ theme: useUIStore.getState().theme })
  })

  it('keeps class, color-scheme, and browser chrome in sync for system theme', () => {
    systemDark = true
    document.documentElement.style.setProperty('--app-bg', '#101318')
    applyThemePreference('system')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    const darkColors = Array.from(document.querySelectorAll('meta[name="theme-color"]'))
      .map(meta => meta.getAttribute('content'))
    expect(darkColors).toEqual(['#101318', '#101318'])

    systemDark = false
    document.documentElement.style.setProperty('--app-bg', '#f2f2f7')
    useUIStore.getState().setTheme('system')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
    const lightColors = Array.from(document.querySelectorAll('meta[name="theme-color"]'))
      .map(meta => meta.getAttribute('content'))
    expect(lightColors).toEqual(['#f2f2f7', '#f2f2f7'])
    // The status-bar style is static; runtime theme changes must not rewrite it.
    expect(document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content')).toBe('default')
  })
})
