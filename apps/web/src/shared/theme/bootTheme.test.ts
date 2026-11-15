// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd } from 'node:process'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyBootSettingsToDom,
  applyUiSettings,
  BOOT_THEME_COLORS,
  BOOT_THEME_COLORS_BY_ID,
  createBootScript,
  DEFAULT_THEME_SETTINGS,
  KNOWN_THEME_IDS,
  LEGACY_THEME_STORAGE_KEY,
  readLegacyThemeMode,
  readStoredSettings,
  resolveBootSettings,
  resolveDark,
  resolveInitialSettings,
  THEME_MODES,
  THEME_STORAGE_KEY,
  type UiThemeSettings,
} from './bootTheme'
import { DEFAULT_THEME_ID } from './registry'

let systemDark = false

function installThemeEnvironment() {
  systemDark = false
  window.localStorage.clear()
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
  document.documentElement.className = ''
  document.documentElement.removeAttribute('style')
  document.documentElement.removeAttribute('data-theme')
  document.body.innerHTML = '<div id="app-root"></div>'
  document.head.innerHTML = [
    '<meta name="theme-color" content="" />',
    '<meta name="apple-mobile-web-app-status-bar-style" content="" />',
  ].join('')
}

describe('readStoredSettings', () => {
  it.each(['light', 'dark', 'system'] as const)('reads the stored %s setting', (mode) => {
    expect(readStoredSettings(JSON.stringify({ themeId: 'default', mode }))).toEqual({
      themeId: 'default',
      mode,
    })
  })

  it('fills in the defaults per missing field', () => {
    expect(readStoredSettings(JSON.stringify({ mode: 'light' }))).toEqual({ themeId: 'default', mode: 'light' })
    expect(readStoredSettings(JSON.stringify({ themeId: 'default' }))).toEqual({ themeId: 'default', mode: 'dark' })
  })

  it('falls back per field for unknown values and returns null when both are unusable', () => {
    expect(readStoredSettings(JSON.stringify({ themeId: 'missing-theme', mode: 'light' }))).toEqual({
      themeId: 'default',
      mode: 'light',
    })
    expect(readStoredSettings(JSON.stringify({ themeId: 'missing-theme', mode: 'sepia' }))).toBeNull()
    expect(readStoredSettings(JSON.stringify({}))).toBeNull()
    expect(readStoredSettings(JSON.stringify(null))).toBeNull()
    expect(readStoredSettings(null)).toBeNull()
  })

  it('returns null when the persisted JSON is corrupt', () => {
    expect(readStoredSettings('{invalid-json')).toBeNull()
  })
})

describe('readLegacyThemeMode', () => {
  it.each(['light', 'dark', 'system'] as const)('reads the legacy %s preference', (mode) => {
    expect(readLegacyThemeMode(JSON.stringify({ state: { theme: mode }, version: 0 }))).toBe(mode)
  })

  it('returns null for unsupported, missing or corrupt state', () => {
    expect(readLegacyThemeMode(JSON.stringify({ state: { theme: 'sepia' } }))).toBeNull()
    expect(readLegacyThemeMode(JSON.stringify({ state: {} }))).toBeNull()
    expect(readLegacyThemeMode(JSON.stringify({}))).toBeNull()
    expect(readLegacyThemeMode(null)).toBeNull()
    expect(readLegacyThemeMode('{invalid-json')).toBeNull()
  })
})

describe('resolveDark', () => {
  it('resolves explicit modes and the system preference independently', () => {
    expect(resolveDark('dark', false)).toBe(true)
    expect(resolveDark('light', true)).toBe(false)
    expect(resolveDark('system', true)).toBe(true)
    expect(resolveDark('system', false)).toBe(false)
  })
})

describe('applyUiSettings', () => {
  beforeEach(installThemeEnvironment)

  it.each([
    {
      mode: 'light',
      systemDark: false,
      dark: false,
      background: 'rgb(242, 242, 247)',
      themeColor: '#f6f8fb',
      statusBar: 'default',
    },
    {
      mode: 'dark',
      systemDark: false,
      dark: true,
      background: 'rgb(0, 0, 0)',
      themeColor: '#05090c',
      statusBar: 'black-translucent',
    },
    {
      mode: 'system',
      systemDark: true,
      dark: true,
      background: 'rgb(0, 0, 0)',
      themeColor: '#05090c',
      statusBar: 'black-translucent',
    },
    {
      mode: 'system',
      systemDark: false,
      dark: false,
      background: 'rgb(242, 242, 247)',
      themeColor: '#f6f8fb',
      statusBar: 'default',
    },
  ] as const)('applies $mode with systemDark=$systemDark', ({
    mode,
    systemDark: prefersDark,
    dark,
    background,
    themeColor,
    statusBar,
  }) => {
    systemDark = prefersDark
    document.documentElement.setAttribute('data-theme', 'stale-theme')

    applyUiSettings({ themeId: 'default', mode })

    expect(document.documentElement.classList.contains('dark')).toBe(dark)
    expect(document.getElementById('app-root')?.classList.contains('dark')).toBe(dark)
    expect(document.documentElement.style.colorScheme).toBe(dark ? 'dark' : 'light')
    expect(document.documentElement.style.backgroundColor).toBe(background)
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(themeColor)
    expect(document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content')).toBe(statusBar)
  })

  it('applies the default theme boot colors for unknown theme ids', () => {
    systemDark = false

    applyUiSettings({ themeId: 'removed-theme', mode: 'dark' })

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.backgroundColor).toBe('rgb(0, 0, 0)')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('does not resolve object prototype keys as theme ids', () => {
    systemDark = false

    applyUiSettings({ themeId: 'toString', mode: 'light' })

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.style.backgroundColor).toBe('rgb(242, 242, 247)')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('falls back to the default theme for non-string theme ids', () => {
    systemDark = false

    applyUiSettings({ themeId: ['default'], mode: 'light' } as unknown as UiThemeSettings)

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.style.backgroundColor).toBe('rgb(242, 242, 247)')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#f6f8fb')
  })
})

describe('resolveBootSettings', () => {
  const defaults = DEFAULT_THEME_SETTINGS

  it('returns null when neither storage value is usable', () => {
    expect(resolveBootSettings(null, null, KNOWN_THEME_IDS, THEME_MODES, defaults)).toBeNull()
    expect(resolveBootSettings('{invalid-json', '{invalid-json', KNOWN_THEME_IDS, THEME_MODES, defaults)).toBeNull()
    expect(resolveBootSettings('{}', JSON.stringify({ state: {} }), KNOWN_THEME_IDS, THEME_MODES, defaults)).toBeNull()
  })

  it('merges each usable field over the defaults', () => {
    expect(resolveBootSettings(JSON.stringify({ mode: 'light' }), null, KNOWN_THEME_IDS, THEME_MODES, defaults))
      .toEqual({ themeId: DEFAULT_THEME_ID, mode: 'light' })
    expect(resolveBootSettings(JSON.stringify({ themeId: DEFAULT_THEME_ID }), null, KNOWN_THEME_IDS, THEME_MODES, defaults))
      .toEqual({ themeId: DEFAULT_THEME_ID, mode: 'dark' })
  })

  it('falls back to the legacy mode only when the lpn-ui value has no usable field', () => {
    const legacy = JSON.stringify({ state: { theme: 'light' }, version: 0 })

    expect(resolveBootSettings(
      JSON.stringify({ themeId: 'missing-theme', mode: 'sepia' }),
      legacy,
      KNOWN_THEME_IDS,
      THEME_MODES,
      defaults,
    )).toEqual({ themeId: DEFAULT_THEME_ID, mode: 'light' })
    expect(resolveBootSettings(
      JSON.stringify({ themeId: 'missing-theme', mode: 'light' }),
      legacy,
      KNOWN_THEME_IDS,
      THEME_MODES,
      defaults,
    )).toEqual({ themeId: DEFAULT_THEME_ID, mode: 'light' })
  })

  it('does not treat object prototype keys as known theme ids', () => {
    expect(resolveBootSettings(
      JSON.stringify({ themeId: 'toString', mode: 'light' }),
      null,
      KNOWN_THEME_IDS,
      THEME_MODES,
      defaults,
    )).toEqual({ themeId: DEFAULT_THEME_ID, mode: 'light' })
    expect(resolveBootSettings(
      JSON.stringify({ themeId: 'toString' }),
      null,
      KNOWN_THEME_IDS,
      THEME_MODES,
      defaults,
    )).toBeNull()
  })
})

describe('applyBootSettingsToDom', () => {
  beforeEach(installThemeEnvironment)

  const palettes = {
    default: {
      light: { background: '#f2f2f7', themeColor: '#f6f8fb', statusBar: 'default' },
      dark: { background: '#000000', themeColor: '#05090c', statusBar: 'black-translucent' },
    },
    alt: {
      light: { background: '#eeeeee', themeColor: '#222222', statusBar: 'default' },
      dark: { background: '#111111', themeColor: '#333333', statusBar: 'black-translucent' },
    },
  }

  it('applies an explicit theme palette and data-theme attribute', () => {
    applyBootSettingsToDom({ themeId: 'alt', mode: 'dark' }, palettes, DEFAULT_THEME_ID, true, document)

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('alt')
    expect(document.documentElement.style.backgroundColor).toBe('rgb(17, 17, 17)')
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#333333')
  })

  it('falls back to the default palette and removes data-theme for unknown ids', () => {
    document.documentElement.setAttribute('data-theme', 'stale-theme')

    applyBootSettingsToDom({ themeId: 'missing-theme', mode: 'light' }, palettes, DEFAULT_THEME_ID, false, document)

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(document.documentElement.style.backgroundColor).toBe('rgb(242, 242, 247)')
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#f6f8fb')
  })
})

interface BootStorageCase {
  name: string
  lpn: string | null
  legacy: string | null
  systemDark: boolean
}

const BOOT_STORAGE_CASES: BootStorageCase[] = [
  { name: 'nothing stored with a light system', lpn: null, legacy: null, systemDark: false },
  { name: 'nothing stored with a dark system', lpn: null, legacy: null, systemDark: true },
  { name: 'stored light mode', lpn: JSON.stringify({ themeId: 'default', mode: 'light' }), legacy: null, systemDark: false },
  { name: 'stored dark mode', lpn: JSON.stringify({ themeId: 'default', mode: 'dark' }), legacy: null, systemDark: false },
  { name: 'stored system mode with a dark system', lpn: JSON.stringify({ themeId: 'default', mode: 'system' }), legacy: null, systemDark: true },
  { name: 'stored system mode with a light system', lpn: JSON.stringify({ themeId: 'default', mode: 'system' }), legacy: null, systemDark: false },
  { name: 'lpn-ui missing the theme id', lpn: JSON.stringify({ mode: 'light' }), legacy: null, systemDark: false },
  { name: 'lpn-ui missing the mode', lpn: JSON.stringify({ themeId: 'default' }), legacy: null, systemDark: false },
  { name: 'lpn-ui with an unknown theme', lpn: JSON.stringify({ themeId: 'missing-theme', mode: 'light' }), legacy: null, systemDark: false },
  { name: 'lpn-ui with a non-string theme id', lpn: JSON.stringify({ themeId: ['default'], mode: 'light' }), legacy: null, systemDark: false },
  { name: 'lpn-ui empty object', lpn: '{}', legacy: null, systemDark: false },
  { name: 'lpn-ui corrupt JSON', lpn: '{invalid-json', legacy: null, systemDark: false },
  { name: 'lpn-ui null literal', lpn: 'null', legacy: null, systemDark: false },
  { name: 'legacy light mode', lpn: null, legacy: JSON.stringify({ state: { theme: 'light' }, version: 0 }), systemDark: false },
  { name: 'legacy dark mode', lpn: null, legacy: JSON.stringify({ state: { theme: 'dark' }, version: 0 }), systemDark: false },
  { name: 'legacy system mode with a dark system', lpn: null, legacy: JSON.stringify({ state: { theme: 'system' }, version: 0 }), systemDark: true },
  { name: 'legacy corrupt JSON', lpn: null, legacy: '{invalid-json', systemDark: false },
  { name: 'lpn-ui wins over legacy', lpn: JSON.stringify({ themeId: 'default', mode: 'light' }), legacy: JSON.stringify({ state: { theme: 'dark' }, version: 0 }), systemDark: false },
  { name: 'partial lpn-ui wins over legacy', lpn: JSON.stringify({ themeId: 'default' }), legacy: JSON.stringify({ state: { theme: 'light' }, version: 0 }), systemDark: false },
  { name: 'lpn-ui unusable fields fall back to legacy', lpn: JSON.stringify({ themeId: 'missing-theme', mode: 'sepia' }), legacy: JSON.stringify({ state: { theme: 'system' }, version: 0 }), systemDark: true },
  { name: 'both storage values corrupt', lpn: '{invalid-json', legacy: '{invalid-json', systemDark: false },
  { name: 'prototype-key theme id falls back to legacy', lpn: JSON.stringify({ themeId: 'toString', mode: 'sepia' }), legacy: JSON.stringify({ state: { theme: 'light' }, version: 0 }), systemDark: false },
]

interface BootDomSnapshot {
  rootDark: boolean
  appRootDark: boolean | null
  colorScheme: string
  backgroundColor: string
  dataTheme: string | null
  themeColor: string | null
  statusBar: string | null
}

function seedBootEnvironment(testCase: BootStorageCase) {
  installThemeEnvironment()
  systemDark = testCase.systemDark
  if (testCase.lpn !== null) window.localStorage.setItem(THEME_STORAGE_KEY, testCase.lpn)
  if (testCase.legacy !== null) window.localStorage.setItem(LEGACY_THEME_STORAGE_KEY, testCase.legacy)
}

function snapshotBootDom(): BootDomSnapshot {
  return {
    rootDark: document.documentElement.classList.contains('dark'),
    appRootDark: document.getElementById('app-root')?.classList.contains('dark') ?? null,
    colorScheme: document.documentElement.style.colorScheme,
    backgroundColor: document.documentElement.style.backgroundColor,
    dataTheme: document.documentElement.getAttribute('data-theme'),
    themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
    statusBar: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content') ?? null,
  }
}

describe('boot script and runtime parity', () => {
  it.each(BOOT_STORAGE_CASES)('$name', (testCase) => {
    seedBootEnvironment(testCase)
    window.eval(createBootScript())
    const fromScript = snapshotBootDom()

    seedBootEnvironment(testCase)
    applyUiSettings(resolveInitialSettings(
      window.localStorage.getItem(THEME_STORAGE_KEY),
      window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY),
    ))
    const fromRuntime = snapshotBootDom()

    expect(fromRuntime).toEqual(fromScript)
  })
})

describe('createBootScript', () => {
  beforeEach(installThemeEnvironment)

  it('contains no module imports, bundler helpers or TypeScript-only syntax', () => {
    const script = createBootScript()

    expect(script).not.toMatch(/\b(?:import|export)\b/)
    expect(script).not.toContain('__name')
    expect(script).not.toMatch(/\b(?:interface|satisfies)\b/)
    expect(script).not.toContain('UiThemeSettings')
    expect(script).not.toContain(' as ThemeMode')
  })

  it('boots into the dark default when nothing is stored', () => {
    window.eval(createBootScript())

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(document.documentElement.style.backgroundColor).toBe('rgb(0, 0, 0)')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('migrates the legacy ui-storage mode on read without writing anything', () => {
    window.localStorage.setItem(
      LEGACY_THEME_STORAGE_KEY,
      JSON.stringify({ state: { theme: 'light' }, version: 0 }),
    )

    window.eval(createBootScript())

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.style.backgroundColor).toBe('rgb(242, 242, 247)')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
    expect(window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY)).toBe(JSON.stringify({ state: { theme: 'light' }, version: 0 }))
  })

  it('prefers the lpn-ui settings over the legacy storage', () => {
    window.localStorage.setItem(
      LEGACY_THEME_STORAGE_KEY,
      JSON.stringify({ state: { theme: 'light' }, version: 0 }),
    )
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ themeId: 'default', mode: 'dark' }))

    window.eval(createBootScript())

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('boots light from stored settings', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ themeId: 'default', mode: 'light' }))

    window.eval(createBootScript())

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#f6f8fb')
  })

  it('falls back to the default theme for unknown theme ids', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ themeId: 'removed-theme', mode: 'light' }))

    window.eval(createBootScript())

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(JSON.stringify({ themeId: 'removed-theme', mode: 'light' }))
  })

  it('marks the standalone viewport', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(display-mode: standalone)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))

    window.eval(createBootScript())

    expect(document.documentElement.classList.contains('la-pluma-standalone')).toBe(true)
    expect(document.documentElement.classList.contains('device-full-viewport')).toBe(true)
  })
})

describe('default settings', () => {
  it('keeps the dark default consistent with the boot colors', () => {
    expect(DEFAULT_THEME_SETTINGS).toEqual({ themeId: 'default', mode: 'dark' })
    expect(BOOT_THEME_COLORS.dark.background).toBe('#000000')
  })

  it('keeps the default theme registered in the theme list and boot palette', () => {
    expect(KNOWN_THEME_IDS).toContain(DEFAULT_THEME_ID)
    expect(BOOT_THEME_COLORS_BY_ID[DEFAULT_THEME_ID]).toBeDefined()
  })
})

// jsdom 环境下 import.meta.url 不是 file: 协议，按 vitest 的 client 根目录取源文件。
const CLIENT_ROOT = cwd()

interface CssDeclaration {
  value: string
  line: number
}

function findDeclaration(
  source: string,
  blockPattern: RegExp,
  property: string,
): CssDeclaration | null {
  const block = blockPattern.exec(source)
  if (!block) return null

  const bodyStart = block.index + block[0].length
  let depth = 1
  let bodyEnd = source.length
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] !== '}') continue
    depth -= 1
    if (depth === 0) {
      bodyEnd = index
      break
    }
  }

  const declaration = new RegExp(`(?:^|[\\s;])${property}\\s*:\\s*([^;}]+)`)
    .exec(source.slice(bodyStart, bodyEnd))
  const value = declaration?.[1]?.trim()
  if (!declaration || !value) return null

  return {
    value,
    line: source.slice(0, bodyStart + declaration.index).split('\n').length,
  }
}

// 首帧背景色横跨两套无法共享代码的层：构建期常量（BOOT_THEME_COLORS）与手写 CSS
// （index.html 内联启动样式、index.css / ios-theme.css 页面底色）；不一致时首帧会闪旧色。
// 这是 docs/development/README.md「禁止枚举式 grep CSS」的例外（同 animations.test.ts）：
// 不枚举选择器清单，只核对同一语义在两处的取值一致。深色页面底色候选有两个：
// index.css 的 --background 与 ios-theme.css 的 --glass-page-bg；两者同属 @layer base，
// ios-theme.css 后加载，其 html, body { background: ... } 简写覆盖前者，因此校验后者。
describe('first-paint background colors', () => {
  const checks = [
    {
      label: 'index.html light --boot-bg',
      file: 'index.html',
      blockPattern: /^\s*:root\s*\{/m,
      property: '--boot-bg',
      expected: BOOT_THEME_COLORS.light.background,
    },
    {
      label: 'index.html dark --boot-bg',
      file: 'index.html',
      blockPattern: /^\s*html\.dark\s*\{/m,
      property: '--boot-bg',
      expected: BOOT_THEME_COLORS.dark.background,
    },
    {
      label: 'index.css light page background',
      file: 'src/styles/index.css',
      blockPattern: /^\s*:root\s*\{/m,
      property: '--background',
      expected: BOOT_THEME_COLORS.light.background,
    },
    {
      label: 'ios-theme.css dark page background',
      file: 'src/styles/ios-theme.css',
      blockPattern: /^\s*html\.dark,\s*\n\s*#app-root\.dark\s*\{/m,
      property: '--glass-page-bg',
      expected: BOOT_THEME_COLORS.dark.background,
    },
  ]

  it('keeps hand-written first-paint backgrounds in sync with BOOT_THEME_COLORS', () => {
    const mismatches = checks.flatMap(({ label, file, blockPattern, property, expected }) => {
      const source = readFileSync(join(CLIENT_ROOT, file), 'utf8')
      const declaration = findDeclaration(source, blockPattern, property)

      if (!declaration) {
        return [`${label}: ${file} 中找不到 ${property} 声明`]
      }
      if (declaration.value.toLowerCase() === expected.toLowerCase()) return []
      return [`${label}: ${file}:${declaration.line} 期望 ${expected}，实际 ${declaration.value}`]
    })

    expect(mismatches).toEqual([])
  })
})
