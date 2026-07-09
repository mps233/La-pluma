import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { useUIStore } from '@/stores'

type ThemeMode = 'light' | 'dark' | 'system'

type ColorVariant = 'violet' | 'emerald' | 'fuchsia' | 'blue' | 'cyan' | 'teal' | 'orange' | 'amber'

interface ThemeToggleProps {
  color?: ColorVariant
}

export default function ThemeToggle({ color: _color = 'violet' }: ThemeToggleProps) {
  void _color

  // 使用 UI Store 管理主题
  const theme = useUIStore(state => state.theme)
  const setTheme = useUIStore(state => state.setTheme)

  useEffect(() => {
    // 应用主题到 DOM
    applyTheme(theme as ThemeMode)

    // 监听系统主题变化
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (e: MediaQueryListEvent) => {
      if (theme === 'system') {
        applyTheme('system', e.matches ? 'dark' : 'light')
      }
    }
    
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme])

  const applyTheme = (selectedTheme: ThemeMode, systemTheme?: 'dark' | 'light') => {
    const root = document.documentElement
    let isDark = false
    
    if (selectedTheme === 'system') {
      const actualSystemTheme = systemTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      if (actualSystemTheme === 'dark') {
        root.classList.add('dark')
        isDark = true
      } else {
        root.classList.remove('dark')
        isDark = false
      }
    } else if (selectedTheme === 'dark') {
      root.classList.add('dark')
      isDark = true
    } else {
      root.classList.remove('dark')
      isDark = false
    }
    
    // 更新手机状态栏颜色（主要针对 Android Chrome）
    const metaThemeColor = document.querySelector('meta[name="theme-color"]')
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', isDark ? '#070707' : '#f9fafb')
    }
  }

  const handleThemeChange = (newTheme: ThemeMode) => {
    setTheme(newTheme)
  }

  return (
    <div className="surface-soft flex items-center gap-1.5 rounded-2xl p-1.5">
      {/* 亮色模式 */}
      <motion.button
        onClick={() => handleThemeChange('light')}
        className={`theme-toggle-btn p-1.5 rounded-xl transition-all ${
          theme === 'light'
            ? 'brand-action text-white'
            : 'text-tertiary hover:bg-white/70 hover:text-primary dark:hover:bg-white/10'
        }`}
        whileHover={{ y: -1 }}
        whileTap={{ y: 0, scale: 0.96 }}
        title="亮色模式"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      </motion.button>

      {/* 暗色模式 */}
      <motion.button
        onClick={() => handleThemeChange('dark')}
        className={`theme-toggle-btn p-1.5 rounded-xl transition-all ${
          theme === 'dark'
            ? 'brand-action text-white'
            : 'text-tertiary hover:bg-white/70 hover:text-primary dark:hover:bg-white/10'
        }`}
        whileHover={{ y: -1 }}
        whileTap={{ y: 0, scale: 0.96 }}
        title="暗色模式"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      </motion.button>

      {/* 跟随系统 */}
      <motion.button
        onClick={() => handleThemeChange('system')}
        className={`theme-toggle-btn p-1.5 rounded-xl transition-all ${
          theme === 'system'
            ? 'brand-action text-white'
            : 'text-tertiary hover:bg-white/70 hover:text-primary dark:hover:bg-white/10'
        }`}
        whileHover={{ y: -1 }}
        whileTap={{ y: 0, scale: 0.96 }}
        title="跟随系统"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      </motion.button>
    </div>
  )
}
