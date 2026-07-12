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
    { id: 'dashboard', name: '控制台', color: 'cyan' as const },
    { id: 'automation', name: '自动化', color: 'cyan' as const },
    { id: 'combat', name: '作业', color: 'cyan' as const },
    { id: 'roguelike', name: '肉鸽', color: 'cyan' as const },
    { id: 'training', name: '养成', color: 'cyan' as const },
    { id: 'logs', name: '日志', color: 'cyan' as const },
    { id: 'statistics', name: '数据', color: 'cyan' as const },
    { id: 'config', name: '配置', color: 'cyan' as const },
  ]

  type TabColor = 'violet' | 'emerald' | 'fuchsia' | 'amber' | 'blue' | 'cyan' | 'teal' | 'orange'

  const getTabColors = (_color: TabColor, isActive: boolean) => {
    void _color
    return isActive ? 'nav-item-active' : 'nav-item-idle'
  }


  return (
    <div className="min-h-screen transition-colors">
      {/* 顶部导航栏 - 包含标题和标签页 */}
      <motion.nav 
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        className="nav-shell sticky top-0 z-50 transition-colors"
      >
        <div className="app-shell">
          <div className="flex justify-between items-center h-14 sm:h-16">
            {/* 左侧：Logo 和标题 */}
            <div className="flex items-center gap-2 sm:gap-3">
              <img 
                src="/logo-graphite.svg?v=1"
                alt="La Pluma Logo" 
                className="h-7 w-7 object-contain sm:h-8 sm:w-8"
              />
              <h1 className="text-primary text-base font-semibold tracking-tight sm:text-lg">
                La Pluma
              </h1>
            </div>

            {/* 右侧：标签页导航 + 系统信息 */}
            <div className="flex items-center gap-3 sm:gap-5">
              {/* 桌面端标签页导航 */}
              <div className="surface-soft hidden gap-1 rounded-2xl p-1.5 lg:flex">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`
                      relative flex items-center px-3.5 py-2 font-medium text-sm rounded-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]
                      ${getTabColors(tab.color, activeTab === tab.id)}
                    `}
                  >
                    <span>{tab.name}</span>
                  </button>
                ))}
              </div>

              {/* 主题切换器 */}
              <ThemeToggle color="cyan" />

              {/* 移动端汉堡菜单按钮 */}
              <button
                type="button"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label={mobileMenuOpen ? '关闭导航菜单' : '打开导航菜单'}
                aria-expanded={mobileMenuOpen}
                aria-controls="mobile-navigation"
                className="text-secondary hover:text-primary lg:hidden rounded-lg p-2 transition-colors hover:bg-white/60 dark:hover:bg-white/10"
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
                href="https://github.com/mps233/La-pluma"
                target="_blank"
                rel="noopener noreferrer"
                className="text-secondary hover:text-primary hidden items-center justify-center rounded-lg p-2 transition-all hover:bg-white/60 dark:hover:bg-white/10 sm:flex"
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
                id="mobile-navigation"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="lg:hidden py-2 shadow-[inset_0_1px_0_var(--app-border)]"
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
                        flex items-center px-4 py-3 font-medium text-sm rounded-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]
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
      <main className="app-shell py-3 sm:py-8">
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
