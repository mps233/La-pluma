// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cwd } from 'node:process'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const indexSource = readFileSync(resolve(cwd(), 'index.html'), 'utf8')
const sourceDocument = new DOMParser().parseFromString(indexSource, 'text/html')
const bootScript = Array.from(sourceDocument.scripts)
  .find(script => !script.type && !script.src)
  ?.textContent ?? ''
const originalMatchMedia = window.matchMedia

function installThemeDocument() {
  document.documentElement.className = 'dark'
  document.documentElement.removeAttribute('style')
  document.head.innerHTML = `
    <meta name="theme-color" content="#05090c" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  `
  document.body.innerHTML = '<div id="root"></div>'
  Object.defineProperty(window.navigator, 'standalone', {
    configurable: true,
    value: false,
  })
}

function runBootScript({ systemDark = false } = {}) {
  window.matchMedia = vi.fn().mockImplementation(query => ({
    matches: query === '(prefers-color-scheme: dark)' && systemDark,
    media: query,
  }))
  window.eval(bootScript)
}

describe('PWA document boot shell', () => {
  beforeEach(() => {
    window.localStorage.clear()
    installThemeDocument()
  })

  afterAll(() => {
    window.matchMedia = originalMatchMedia
  })

  it('paints a static shell before the module entry can run', () => {
    const bootStyle = sourceDocument.querySelector('#la-pluma-boot-style')
    const root = sourceDocument.querySelector('#root')
    const bootShell = root?.firstElementChild
    const styleIndex = indexSource.indexOf('id="la-pluma-boot-style"')
    const moduleIndex = indexSource.indexOf('src="/src/main.tsx"')

    expect(bootStyle?.textContent).toMatch(/html,\s*body,\s*#root\s*{[^}]*background-color:/s)
    expect(styleIndex).toBeGreaterThan(0)
    expect(moduleIndex).toBeGreaterThan(styleIndex)
    expect(bootShell?.classList.contains('la-pluma-boot')).toBe(true)
    expect(bootShell?.getAttribute('aria-busy')).toBe('true')
  })

  it('matches the live PWA viewport and safe-area rules', () => {
    const bootCss = sourceDocument.querySelector('#la-pluma-boot-style')?.textContent ?? ''

    expect(bootCss).toMatch(/--boot-viewport-height:\s*100dvh/)
    expect(bootCss).toMatch(/display-mode:\s*standalone[\s\S]*--boot-viewport-height:\s*100lvh/)
    expect(bootCss).toMatch(/html\.la-pluma-standalone\s*{[^}]*--boot-viewport-height:\s*100lvh/s)
    expect(bootCss).toMatch(/@supports not \(height:\s*100lvh\)/)
    expect(bootCss).toMatch(/--boot-bottom-clearance:\s*clamp\([\s\S]*?0\.5rem,[\s\S]*?safe-area-inset-bottom[\s\S]*?1\.25rem[\s\S]*?\)/)
    expect(bootCss).toMatch(/right:\s*max\(0\.875rem,\s*env\(safe-area-inset-right/)
    expect(bootCss).toMatch(/left:\s*max\(0\.875rem,\s*env\(safe-area-inset-left/)
    expect(bootCss).toMatch(/bottom:\s*var\(--boot-bottom-clearance\)/)
  })

  it('is replaced by the first React commit', async () => {
    const sourceRoot = sourceDocument.querySelector('#root')
    document.body.innerHTML = sourceRoot?.outerHTML ?? '<div id="root"></div>'
    const rootElement = document.getElementById('root')
    expect(rootElement?.querySelector('.la-pluma-boot')).toBeTruthy()

    const reactRoot = createRoot(rootElement)
    await act(async () => {
      reactRoot.render(createElement('main', { 'data-react-ready': 'true' }, '已恢复'))
    })

    expect(rootElement?.querySelector('.la-pluma-boot')).toBeNull()
    expect(rootElement?.querySelector('[data-react-ready="true"]')?.textContent).toBe('已恢复')

    await act(async () => reactRoot.unmount())
  })

  it.each([
    { storedTheme: 'light', systemDark: false, dark: false, background: 'rgb(242, 242, 247)', themeColor: '#f6f8fb' },
    { storedTheme: 'dark', systemDark: false, dark: true, background: 'rgb(0, 0, 0)', themeColor: '#05090c' },
    { storedTheme: 'system', systemDark: true, dark: true, background: 'rgb(0, 0, 0)', themeColor: '#05090c' },
    { storedTheme: 'system', systemDark: false, dark: false, background: 'rgb(242, 242, 247)', themeColor: '#f6f8fb' },
  ])('applies $storedTheme before external assets load', ({ storedTheme, systemDark, dark, background, themeColor }) => {
    window.localStorage.setItem('ui-storage', JSON.stringify({ state: { theme: storedTheme } }))

    runBootScript({ systemDark })

    expect(document.documentElement.classList.contains('dark')).toBe(dark)
    expect(document.documentElement.style.colorScheme).toBe(dark ? 'dark' : 'light')
    expect(document.documentElement.style.backgroundColor).toBe(background)
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(themeColor)
  })

  it('falls back to the default dark boot surface when stored state is corrupt', () => {
    window.localStorage.setItem('ui-storage', '{invalid-json')

    runBootScript()

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.backgroundColor).toBe('rgb(0, 0, 0)')
  })
})
