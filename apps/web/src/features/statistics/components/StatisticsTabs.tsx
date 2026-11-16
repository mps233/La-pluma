import Icons from '@/shared/components/Icons'
import { SegmentedTabNav, type SegmentedTabOption } from '@/shared/components'
import type { ActiveTab } from '../types'

interface StatisticsTabsProps {
  activeTab: ActiveTab
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

const options: readonly SegmentedTabOption<ActiveTab>[] = statisticsTabs.map((tab) => {
  const TabIcon = Icons[tab.icon]
  return {
    value: tab.id,
    label: tab.title,
    description: tab.description,
    icon: <TabIcon />,
  }
})

export default function StatisticsTabs({ activeTab }: StatisticsTabsProps) {
  return (
    <SegmentedTabNav
      ariaLabel="数据统计视图"
      value={activeTab}
      options={options}
      className="data-statistics-view-switcher data-statistics-mode-shell"
      listClassName="data-statistics-mode-tabs"
      indicatorClassName="data-statistics-mode-highlight"
      indicatorTestId="data-statistics-tab-highlight"
      tabClassName="data-statistics-mode-button min-h-11"
      iconClassName="data-statistics-mode-icon"
      tabId={id => `data-statistics-tab-${id}`}
      panelId={id => `data-statistics-panel-${id}`}
    />
  )
}
