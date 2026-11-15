/**
 * 启动主题的单一真源：构建期注入的首帧脚本与运行时 Provider 共用同一组设置解析、
 * DOM 应用与存储迁移约定，避免两套实现漂移；模块顶层不访问 document/window，
 * 构建期（Node）可安全导入。
 */

import { DEFAULT_THEME_ID, THEMES, getTheme, type ThemeBootColors } from './registry'

export type ThemeMode = 'light' | 'dark' | 'system'

export interface UiThemeSettings {
  themeId: string
  mode: ThemeMode
}

export interface BootThemePalette {
  light: ThemeBootColors
  dark: ThemeBootColors
}

export const THEME_STORAGE_KEY = 'lpn-ui'
/** 旧 zustand persist 存储，只在升级迁移读取时出现，任何路径都不得再写入。 */
export const LEGACY_THEME_STORAGE_KEY = 'ui-storage'

export const THEME_MODES = ['light', 'dark', 'system'] as const
export const PREFERS_DARK_MEDIA = '(prefers-color-scheme: dark)'
const DEFAULT_MODE: ThemeMode = 'dark'

export const DEFAULT_THEME_SETTINGS: UiThemeSettings = { themeId: DEFAULT_THEME_ID, mode: DEFAULT_MODE }

const defaultTheme = getTheme(DEFAULT_THEME_ID) ?? THEMES[0]!

export const KNOWN_THEME_IDS: readonly string[] = Object.freeze(THEMES.map(theme => theme.id))

/** 「主题 × 模式」的完整首帧色卡；启动脚本按同一份数据序列化，避免手抄 hex。 */
export const BOOT_THEME_COLORS_BY_ID: Readonly<Record<string, BootThemePalette>> = Object.freeze(
  Object.fromEntries(THEMES.map(theme => [theme.id, theme.boot])),
)

/** 首帧静态默认色卡（默认主题）；「主题 × 模式」的完整色卡在 ThemeDefinition.boot。 */
export const BOOT_THEME_COLORS = {
  light: defaultTheme.boot.light,
  dark: defaultTheme.boot.dark,
}

// createBootScript 通过 Function.prototype.toString() 内联下列函数，因此它们只能依赖
// 参数与全局对象；一旦引用模块作用域，构建链打包后会留下浏览器中不存在的绑定。
export function resolveDark(mode: ThemeMode, prefersDark: boolean): boolean {
  return mode === 'dark' || (mode === 'system' && prefersDark)
}

/** 解析 lpn-ui 与旧 ui-storage；两者都不可用时返回 null，由调用方决定默认值。 */
export function resolveBootSettings(
  rawLpn: string | null,
  rawLegacy: string | null,
  themeIds: readonly string[],
  modes: readonly string[],
  defaultSettings: UiThemeSettings,
): UiThemeSettings | null {
  if (rawLpn) {
    let stored: unknown = null
    try {
      stored = JSON.parse(rawLpn)
    } catch {
      stored = null
    }
    if (stored && typeof stored === 'object') {
      const { themeId, mode } = stored as Partial<UiThemeSettings>
      const knownThemeId = typeof themeId === 'string' && themeIds.includes(themeId) ? themeId : null
      const knownMode = typeof mode === 'string' && modes.includes(mode) ? mode as ThemeMode : null
      if (knownThemeId || knownMode) {
        return {
          themeId: knownThemeId ?? defaultSettings.themeId,
          mode: knownMode ?? defaultSettings.mode,
        }
      }
    }
  }

  if (rawLegacy) {
    let legacy: unknown = null
    try {
      legacy = JSON.parse(rawLegacy)
    } catch {
      legacy = null
    }
    const mode = (legacy as { state?: { theme?: unknown } } | null)?.state?.theme
    if (typeof mode === 'string' && modes.includes(mode)) {
      return { themeId: defaultSettings.themeId, mode: mode as ThemeMode }
    }
  }

  return null
}

/** 把已解析的设置写入 DOM；`dark` 由 resolveDark 计算，主题色卡未知时回退默认主题。 */
export function applyBootSettingsToDom(
  settings: UiThemeSettings,
  colorsByTheme: Readonly<Record<string, BootThemePalette>>,
  defaultThemeId: string,
  dark: boolean,
  doc: Document,
): void {
  const themeId = typeof settings.themeId === 'string'
    && Object.prototype.hasOwnProperty.call(colorsByTheme, settings.themeId)
    ? settings.themeId
    : defaultThemeId
  const boot = colorsByTheme[themeId]
    ?? colorsByTheme[defaultThemeId]
    ?? Object.values(colorsByTheme)[0]!
  const colors = dark ? boot.dark : boot.light
  const root = doc.documentElement

  root.classList.toggle('dark', dark)
  doc.getElementById('app-root')?.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
  root.style.backgroundColor = colors.background
  if (themeId === defaultThemeId) {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', themeId)
  }
  doc.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', colors.themeColor)
  doc.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
    ?.setAttribute('content', colors.statusBar)
}

/** 解析 lpn-ui 明文 JSON（{themeId, mode}）；缺项逐项回退，两项皆不可用返回 null。 */
export function readStoredSettings(raw: string | null): UiThemeSettings | null {
  return resolveBootSettings(raw, null, KNOWN_THEME_IDS, THEME_MODES, DEFAULT_THEME_SETTINGS)
}

/** 解析旧 ui-storage（zustand persist）写入的 `{"state":{"theme":...}}`，非法值或损坏 JSON 返回 null。 */
export function readLegacyThemeMode(raw: string | null): ThemeMode | null {
  return resolveBootSettings(null, raw, KNOWN_THEME_IDS, THEME_MODES, DEFAULT_THEME_SETTINGS)?.mode ?? null
}

/** Provider 初始化的读取优先级：lpn-ui → legacy → 默认设置；首帧脚本复用同一解析函数。 */
export function resolveInitialSettings(rawLpn: string | null, rawLegacy: string | null): UiThemeSettings {
  return resolveBootSettings(rawLpn, rawLegacy, KNOWN_THEME_IDS, THEME_MODES, DEFAULT_THEME_SETTINGS)
    ?? DEFAULT_THEME_SETTINGS
}

export function applyUiSettings(settings: UiThemeSettings, prefersDark?: boolean): void {
  if (typeof document === 'undefined') return

  const resolvedPrefersDark = prefersDark
    ?? (typeof window !== 'undefined' && window.matchMedia?.(PREFERS_DARK_MEDIA).matches === true)
  const dark = resolveDark(settings.mode, resolvedPrefersDark)
  applyBootSettingsToDom(settings, BOOT_THEME_COLORS_BY_ID, DEFAULT_THEME_ID, dark, document)
}

/** 生成可内联的启动脚本（standalone 视口标记 + 主题设置恢复 + 旧存储迁移读取）；数据从 registry 与本模块常量插值，脚本不另抄一份 hex。 */
export function createBootScript(): string {
  const themeBootColors = JSON.stringify(BOOT_THEME_COLORS_BY_ID)
  const themeIds = JSON.stringify(KNOWN_THEME_IDS)
  const modeList = JSON.stringify(THEME_MODES)
  const defaultSettings = JSON.stringify(DEFAULT_THEME_SETTINGS)
  const storageKey = JSON.stringify(THEME_STORAGE_KEY)
  const legacyKey = JSON.stringify(LEGACY_THEME_STORAGE_KEY)
  const defaultThemeId = JSON.stringify(DEFAULT_THEME_ID)
  const darkMedia = JSON.stringify(PREFERS_DARK_MEDIA)

  return `(() => {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches
    || window.matchMedia?.('(display-mode: fullscreen)').matches
    || window.navigator.standalone === true
  if (standalone) {
    // Claim the full iOS standalone viewport while keeping status icons
    // readable in both color schemes.
    document.documentElement.classList.add('la-pluma-standalone', 'device-full-viewport')
  }

  const resolveDark = ${resolveDark.toString()}
  const resolveBootSettings = ${resolveBootSettings.toString()}
  const applyBootSettingsToDom = ${applyBootSettingsToDom.toString()}
  const themeBootColors = ${themeBootColors}
  const themeIds = ${themeIds}
  const modes = ${modeList}
  const defaultSettings = ${defaultSettings}
  const readStorage = (key) => {
    try { return localStorage.getItem(key) } catch { return null }
  }
  const settings = resolveBootSettings(
    readStorage(${storageKey}),
    readStorage(${legacyKey}),
    themeIds,
    modes,
    defaultSettings,
  ) || defaultSettings
  const prefersDark = window.matchMedia?.(${darkMedia}).matches === true
  applyBootSettingsToDom(
    settings,
    themeBootColors,
    ${defaultThemeId},
    resolveDark(settings.mode, prefersDark),
    document,
  )
})()`
}
