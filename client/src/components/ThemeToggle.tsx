import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { useUIStore } from '@/stores'

type ThemeMode = 'light' | 'dark' | 'system'

type ColorVariant = 'violet' | 'emerald' | 'fuchsia' | 'blue' | 'cyan' | 'teal' | 'orange' | 'amber'

interface ThemeToggleProps {
  color?: ColorVariant
}

export default function ThemeToggle({ color = 'violet' }: ThemeToggleProps) {
  // 使用 UI Store 管理主题
  const theme = useUIStore(state => state.theme)
  const setTheme = useUIStore(state => state.setTheme)

  // 根据颜色生成对应的 Tailwind 类
  const getColorClasses = (): string => {
    const colorMap: Record<ColorVariant, string> = {
      violet: 'bg-gradient-to-r from-violet-400 via-purple-400 to-fuchsia-400',
      emerald: 'bg-gradient-to-r from-emerald-400 via-green-400 to-teal-400',
      fuchsia: 'bg-gradient-to-r from-purple-400 via-fuchsia-400 to-pink-400',
      blue: 'bg-gradient-to-r from-cyan-400 via-blue-400 to-indigo-400',
      cyan: 'bg-gradient-to-r from-cyan-400 via-blue-400 to-indigo-400',
      teal: 'bg-gradient-to-r from-teal-400 via-cyan-400 to-blue-400',
      orange: 'bg-gradient-to-r from-orange-400 via-red-400 to-pink-400',
      amber: 'bg-gradient-to-r from-amber-400 via-orange-400 to-red-400',
    }
    return colorMap[color] || colorMap.violet
  }

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
    <div className="flex items-center space-x-2 bg-gray-100 dark:bg-white/5 rounded-lg p-1 border border-gray-200 dark:border-white/10">
      {/* 亮色模式 */}
      <motion.button
        onClick={() => handleThemeChange('light')}
        className={`theme-toggle-btn p-1.5 rounded-md transition-all ${
          theme === 'light'
            ? `${getColorClasses()} text-white shadow-lg`
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/10'
        }`}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        title="亮色模式"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      </motion.button>

      {/* 暗色模式 */}
      <motion.button
        onClick={() => handleThemeChange('dark')}
        className={`theme-toggle-btn p-1.5 rounded-md transition-all ${
          theme === 'dark'
            ? `${getColorClasses()} text-white shadow-lg`
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/10'
        }`}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        title="暗色模式"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      </motion.button>

      {/* 跟随系统 */}
      <motion.button
        onClick={() => handleThemeChange('system')}
        className={`theme-toggle-btn p-1.5 rounded-md transition-all ${
          theme === 'system'
            ? `${getColorClasses()} text-white shadow-lg`
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/10'
        }`}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        title="跟随系统"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      </motion.button>
    </div>
  )
}
