import { motion, useReducedMotion } from 'framer-motion'
import Icons from '@/shared/components/Icons'
import { useFluidTabIndicator } from '@/shared/hooks/useFluidTabIndicator'
import type { ActiveTab } from '../types'

interface StatisticsTabsProps {
  activeTab: ActiveTab
  onTabChange: (tab: ActiveTab) => void
}

const statisticsTabs = [
  {
    id: 'operbox',
    title: '干员识别',
    description: '档案与养成进度',
    icon: 'Users',
  },
  {
    id: 'depot',
    title: '仓库识别',
    description: '库存与材料分类',
    icon: 'Package',
  },
  {
    id: 'drops',
    title: '掉落记录',
    description: '作战收益统计',
    icon: 'TrendingUp',
  },
] as const satisfies ReadonlyArray<{
  id: ActiveTab
  title: string
  description: string
  icon: 'Users' | 'Package' | 'TrendingUp'
}>

export default function StatisticsTabs({ activeTab, onTabChange }: StatisticsTabsProps) {
  const shouldReduceMotion = useReducedMotion()
  const {
    containerRef,
    activeRect,
    setTabRef,
    handleTabKeyDown,
  } = useFluidTabIndicator(activeTab)

  return (
    <div className="app-workspace-segments app-liquid-tab-pill data-statistics-view-switcher data-statistics-mode-shell">
      <div
        ref={containerRef}
        className="app-workspace-segment-list data-statistics-mode-tabs"
        role="tablist"
        aria-label="数据统计视图"
      >
        {activeRect.width > 0 && (
          <motion.div
            data-testid="data-statistics-tab-highlight"
            aria-hidden="true"
            className="app-workspace-segment-indicator data-statistics-mode-highlight"
            initial={false}
            animate={{
              x: activeRect.x,
              y: activeRect.y,
              width: activeRect.width,
              height: activeRect.height,
            }}
            transition={shouldReduceMotion
              ? { duration: 0 }
              : { type: 'spring', stiffness: 420, damping: 38, mass: 0.72 }}
          />
        )}
        {statisticsTabs.map(tab => {
          const TabIcon = Icons[tab.icon]
          const selected = activeTab === tab.id

          return (
            <button
              key={tab.id}
              ref={setTabRef(tab.id)}
              id={`data-statistics-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`data-statistics-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onTabChange(tab.id)}
              onKeyDown={event => handleTabKeyDown(
                event,
                statisticsTabs.map(option => option.id),
                onTabChange,
              )}
              className={`app-workspace-segment data-statistics-mode-button min-h-11 ${selected ? 'is-selected' : ''}`}
            >
              <span className="app-workspace-segment-icon data-statistics-mode-icon" aria-hidden="true">
                <TabIcon />
              </span>
              <span className="app-workspace-segment-copy">
                <span>{tab.title}</span>
                <small>{tab.description}</small>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
