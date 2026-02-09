import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ThemeToggle from './ThemeToggle'
import { useUIStore } from '@/stores'

interface LayoutProps {
  children: (props: { activeTab: string }) => React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  // 使用 UI Store 管理活动标签页
  const activeTab = useUIStore(state => state.activeTab)
  const setActiveTab = useUIStore(state => state.setActiveTab)
  
  // 移动端菜单状态保持本地管理（不需要全局共享）
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const tabs = [
    { id: 'automation', name: '自动化任务', color: 'violet' as const },
    { id: 'combat', name: '自动战斗', color: 'emerald' as const },
    { id: 'roguelike', name: '肉鸽模式', color: 'fuchsia' as const },
    { id: 'training', name: '干员养成', color: 'amber' as const },
    { id: 'logs', name: '日志查看', color: 'blue' as const },
    { id: 'statistics', name: '数据统计', color: 'teal' as const },
    { id: 'config', name: '配置管理', color: 'orange' as const },
  ]

  type TabColor = 'violet' | 'emerald' | 'fuchsia' | 'amber' | 'blue' | 'cyan' | 'teal' | 'orange'

  const getTabColors = (color: TabColor, isActive: boolean) => {
    const colors: Record<TabColor, { active: string; inactive: string }> = {
      violet: {
        active: 'text-violet-700 dark:text-white bg-gradient-to-r from-violet-100 to-purple-100 dark:from-violet-500/20 dark:to-purple-500/20 border-violet-300 dark:border-violet-500/30',
        inactive: 'text-gray-600 dark:text-gray-400 hover:text-violet-700 dark:hover:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-500/5 border-transparent hover:border-violet-200 dark:hover:border-violet-500/20'
      },
      emerald: {
        active: 'text-emerald-700 dark:text-white bg-gradient-to-r from-emerald-100 to-green-100 dark:from-emerald-500/20 dark:to-green-500/20 border-emerald-300 dark:border-emerald-500/30',
        inactive: 'text-gray-600 dark:text-gray-400 hover:text-emerald-700 dark:hover:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/5 border-transparent hover:border-emerald-200 dark:hover:border-emerald-500/20'
      },
      fuchsia: {
        active: 'text-fuchsia-700 dark:text-white bg-gradient-to-r from-fuchsia-100 to-pink-100 dark:from-fuchsia-500/20 dark:to-pink-500/20 border-fuchsia-300 dark:border-fuchsia-500/30',
        inactive: 'text-gray-600 dark:text-gray-400 hover:text-fuchsia-700 dark:hover:text-fuchsia-300 hover:bg-fuchsia-50 dark:hover:bg-fuchsia-500/5 border-transparent hover:border-fuchsia-200 dark:hover:border-fuchsia-500/20'
      },
      blue: {
        active: 'text-blue-700 dark:text-white bg-gradient-to-r from-blue-100 to-cyan-100 dark:from-blue-500/20 dark:to-cyan-500/20 border-blue-300 dark:border-blue-500/30',
        inactive: 'text-gray-600 dark:text-gray-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-500/5 border-transparent hover:border-blue-200 dark:hover:border-blue-500/20'
      },
      cyan: {
        active: 'text-cyan-700 dark:text-white bg-gradient-to-r from-cyan-100 to-teal-100 dark:from-cyan-500/20 dark:to-teal-500/20 border-cyan-300 dark:border-cyan-500/30',
        inactive: 'text-gray-600 dark:text-gray-400 hover:text-cyan-700 dark:hover:text-cyan-300 hover:bg-cyan-50 dark:hover:bg-cyan-500/5 border-transparent hover:border-cyan-200 dark:hover:border-cyan-500/20'
      },
      teal: {
        active: 'text-teal-700 dark:text-white bg-gradient-to-r from-teal-100 to-cyan-100 dark:from-teal-500/20 dark:to-cyan-500/20 border-teal-300 dark:border-teal-500/30',
        inactive: 'text-gray-600 dark:text-gray-400 hover:text-teal-700 dark:hover:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-500/5 border-transparent hover:border-teal-200 dark:hover:border-teal-500/20'
      },
      orange: {
        active: 'text-orange-700 dark:text-white bg-gradient-to-r from-orange-100 to-amber-100 dark:from-orange-500/20 dark:to-amber-500/20 border-orange-300 dark:border-orange-500/30',
        inactive: 'text-gray-600 dark:text-gray-400 hover:text-orange-700 dark:hover:text-orange-300 hover:bg-orange-50 dark:hover:bg-orange-500/5 border-transparent hover:border-orange-200 dark:hover:border-orange-500/20'
      },
      amber: {
        active: 'text-amber-700 dark:text-white bg-gradient-to-r from-amber-100 to-yellow-100 dark:from-amber-500/20 dark:to-yellow-500/20 border-amber-300 dark:border-amber-500/30',
        inactive: 'text-gray-600 dark:text-gray-400 hover:text-amber-700 dark:hover:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-500/5 border-transparent hover:border-amber-200 dark:hover:border-amber-500/20'
      }
    }
    return isActive ? colors[color].active : colors[color].inactive
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#070707] transition-colors">
      {/* 顶部导航栏 - 包含标题和标签页 */}
      <motion.nav 
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        className="border-b border-gray-300 dark:border-white/10 shadow-sm dark:shadow-lg sticky top-0 z-50 bg-white/30 dark:bg-[rgba(7,7,7,0.3)] backdrop-blur-md transition-colors"
      >
        <div className="max-w-7xl mx-auto px-3 sm:px-6">
          <div className="flex justify-between items-center h-14 sm:h-16">
            {/* 左侧：Logo 和标题 */}
            <div className="flex items-center gap-2 sm:gap-3">
              <img 
                src="/logo.webp?v=2" 
                alt="La Pluma Logo" 
                className="w-5 h-5 sm:w-6 sm:h-6 rounded-lg object-cover"
              />
              <h1 className="text-base sm:text-lg font-bold bg-gradient-to-r from-violet-400 via-purple-400 to-fuchsia-400 bg-clip-text text-transparent">
                La Pluma
              </h1>
            </div>

            {/* 右侧：标签页导航 + 系统信息 */}
            <div className="flex items-center space-x-2 sm:space-x-4">
              {/* 桌面端标签页导航 */}
              <div className="hidden md:flex space-x-2">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`
                      relative flex items-center px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm rounded-lg transition-colors border
                      ${getTabColors(tab.color, activeTab === tab.id)}
                    `}
                  >
                    <span>{tab.name}</span>
                  </button>
                ))}
              </div>

              {/* 主题切换器 */}
              <ThemeToggle color={tabs.find(t => t.id === activeTab)?.color || 'violet'} />

              {/* 移动端汉堡菜单按钮 */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-2 rounded-lg text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
              >
                <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  {mobileMenuOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>

              {/* GitHub 链接 */}
              <a
                href="https://github.com/your-username/your-repo"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:flex items-center justify-center p-2 rounded-lg text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 transition-all group"
                title="GitHub 仓库"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                </svg>
              </a>
            </div>
          </div>

          {/* 移动端菜单 */}
          <AnimatePresence>
            {mobileMenuOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="md:hidden border-t border-gray-200 dark:border-white/10 py-2"
              >
                <div className="flex flex-col space-y-1">
                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => {
                        setActiveTab(tab.id)
                        setMobileMenuOpen(false)
                      }}
                      className={`
                        flex items-center px-4 py-3 font-medium text-sm rounded-lg transition-colors border
                        ${getTabColors(tab.color, activeTab === tab.id)}
                      `}
                    >
                      <span>{tab.name}</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.nav>

      {/* 主内容区域 */}
      <main className="max-w-7xl mx-auto py-2 sm:py-6 px-2 sm:px-6 lg:px-8">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          {children({ activeTab })}
        </motion.div>
      </main>
    </div>
  )
}
