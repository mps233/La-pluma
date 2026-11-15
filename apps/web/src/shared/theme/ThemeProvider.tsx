import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  applyUiSettings,
  DEFAULT_THEME_SETTINGS,
  LEGACY_THEME_STORAGE_KEY,
  PREFERS_DARK_MEDIA,
  resolveDark,
  resolveInitialSettings,
  THEME_STORAGE_KEY,
  type ThemeMode,
  type UiThemeSettings,
} from './bootTheme'
import { getTheme, THEMES } from './registry'
import { ThemeContext, type ThemeContextValue, type ResolvedMode } from './useTheme'

export type { ResolvedMode, ThemeMode }

function readInitialSettings(): UiThemeSettings {
  if (typeof window === 'undefined') return DEFAULT_THEME_SETTINGS
  return resolveInitialSettings(
    window.localStorage.getItem(THEME_STORAGE_KEY),
    window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY),
  )
}

function subscribeSystemDark(onChange: () => void) {
  const media = window.matchMedia(PREFERS_DARK_MEDIA)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<UiThemeSettings>(readInitialSettings)

  const systemDark = useSyncExternalStore(
    subscribeSystemDark,
    () => window.matchMedia(PREFERS_DARK_MEDIA).matches,
    () => false,
  )

  const resolvedMode: ResolvedMode = resolveDark(settings.mode, systemDark) ? 'dark' : 'light'

  useEffect(() => {
    applyUiSettings(settings, systemDark)
    // 首帧脚本只读旧存储，迁移落盘（新 key 写入 + 旧 key 移除）统一由 Provider 完成。
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(settings))
    window.localStorage.removeItem(LEGACY_THEME_STORAGE_KEY)
  }, [settings, systemDark])

  const setThemeId = useCallback((themeId: string) => {
    setSettings(previous => ({ ...previous, themeId }))
  }, [])

  const setMode = useCallback((mode: ThemeMode) => {
    setSettings(previous => ({ ...previous, mode }))
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({
      ...settings,
      resolvedMode,
      activeTheme: getTheme(settings.themeId) ?? THEMES[0]!,
      setThemeId,
      setMode,
    }),
    [settings, resolvedMode, setThemeId, setMode],
  )

  return <ThemeContext value={value}>{children}</ThemeContext>
}
