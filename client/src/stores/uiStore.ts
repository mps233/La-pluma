/**
 * UI Store - 管理主题、模态框等 UI 状态
 */

import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type { UIState } from '@/types/store'

export const APP_TABS = [
  'dashboard',
  'automation',
  'combat',
  'roguelike',
  'training',
  'logs',
  'statistics',
  'config',
] as const

export type AppTab = typeof APP_TABS[number]

type ThemeMode = UIState['theme']
type ThemeRuntimeWindow = Window & {
  __LA_PLUMA_APPLY_THEME__?: (theme: ThemeMode) => void
}

const DEFAULT_TAB: AppTab = 'dashboard'

function basePath() {
  return import.meta.env.BASE_URL.replace(/\/+$/, '')
}

export function isAppTab(value: string): value is AppTab {
  return APP_TABS.includes(value as AppTab)
}

export function appTabFromPath(pathname: string): AppTab | null {
  const base = basePath()
  const relativePath = base && pathname.startsWith(`${base}/`)
    ? pathname.slice(base.length)
    : pathname
  const segments = relativePath.split('/').filter(Boolean)
  if (segments[0] !== 'app') return null
  if (!segments[1]) return DEFAULT_TAB
  return isAppTab(segments[1]) ? segments[1] : null
}

export function appTabPath(tab: AppTab) {
  return `${basePath()}/app/${tab}`
}

function initialAppTab(): AppTab {
  return typeof window === 'undefined'
    ? DEFAULT_TAB
    : appTabFromPath(window.location.pathname) ?? DEFAULT_TAB
}

export function applyThemePreference(theme: ThemeMode) {
  if (typeof document === 'undefined') return

  const runtime = typeof window === 'undefined'
    ? undefined
    : (window as ThemeRuntimeWindow).__LA_PLUMA_APPLY_THEME__
  if (runtime) {
    runtime(theme)
    return
  }

  const isDark = theme === 'dark'
    || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  const root = document.documentElement
  root.classList.toggle('dark', isDark)
  document.getElementById('framework7-root')?.classList.toggle('dark', isDark)
  root.style.colorScheme = isDark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', isDark ? '#05090c' : '#f6f8fb')
  document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
    ?.setAttribute('content', isDark ? 'black-translucent' : 'default')
}

export const useUIStore = create<UIState>()(
  devtools(
    persist(
      (set) => ({
        // State
        theme: 'dark',
        activeTab: initialAppTab(),
        modals: {},
        
        // Actions
        setTheme: (theme) => {
          set({ theme })
          applyThemePreference(theme)
        },
        
        setActiveTab: (tab) => set({ activeTab: tab }),
        
        openModal: (modalId) => set((state) => ({
          modals: { ...state.modals, [modalId]: true }
        })),
        
        closeModal: (modalId) => set((state) => ({
          modals: { ...state.modals, [modalId]: false }
        }))
      }),
      {
        name: 'ui-storage',
        // 标签由 URL 唯一决定，避免持久化状态覆盖浏览器历史。
        partialize: (state) => ({
          theme: state.theme,
        }),
        merge: (persisted, current) => {
          const stored = persisted as Partial<Pick<UIState, 'theme'>> | undefined
          return {
            ...current,
            ...(stored?.theme && ['light', 'dark', 'system'].includes(stored.theme)
              ? { theme: stored.theme }
              : {}),
            activeTab: initialAppTab(),
          }
        },
        onRehydrateStorage: () => (state) => {
          if (state) applyThemePreference(state.theme)
        },
      }
    ),
    { name: 'UIStore' }
  )
)

if (typeof window !== 'undefined') {
  applyThemePreference(useUIStore.getState().theme)
  const systemTheme = window.matchMedia?.('(prefers-color-scheme: dark)')
  const handleSystemThemeChange = () => {
    if (useUIStore.getState().theme === 'system') applyThemePreference('system')
  }

  // Safari/WebViews before the modern MediaQueryList API expose addListener only.
  if (systemTheme && typeof systemTheme.addEventListener === 'function') {
    systemTheme.addEventListener('change', handleSystemThemeChange)
  } else {
    systemTheme?.addListener?.(handleSystemThemeChange)
  }
}
