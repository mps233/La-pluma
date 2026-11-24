import { SegmentedTabNav, type SegmentedTabOption } from '@/shared/components'
import type { ActiveTab } from '../types'

interface StatisticsTabsProps {
  activeTab: ActiveTab
}

const options = [
  { value: 'operbox', label: '干员识别' },
  { value: 'depot', label: '仓库识别' },
  { value: 'drops', label: '掉落记录' },
] as const satisfies readonly SegmentedTabOption<ActiveTab>[]

export default function StatisticsTabs({ activeTab }: StatisticsTabsProps) {
  return (
    <SegmentedTabNav
      ariaLabel="数据统计视图"
      value={activeTab}
      options={options}
      className="data-statistics-mode-shell"
      listClassName="data-statistics-mode-tabs"
      tabClassName="min-h-11"
      tabId={id => `data-statistics-tab-${id}`}
      panelId={id => `data-statistics-panel-${id}`}
    />
  )
}
