import { useCallback } from 'react'
import { useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { gameDataKeys } from '@/features/game-data'
import { useResourceInvalidation } from '@/features/resource-invalidation'
import { SegmentedTabs, SegmentedTabPanel } from '@/shared/components'
import { useStatisticsCommands } from '../hooks/useStatisticsCommands'
import { statisticsKeys } from '../model/queryKeys'
import {
  DEFAULT_STATISTICS_TAB,
  readStatisticsTab,
  STATISTICS_TAB_PARAM,
} from '../model/tabNavigation'
import DepotPanel from './DepotPanel'
import DropPanel from './DropPanel'
import OperatorPanel from './OperatorPanel'
import StatisticsTabs from './StatisticsTabs'
import type { ActiveTab } from '../types'

const STATISTICS_RESOURCE_SCOPES = ['depot', 'operbox', 'catalog', 'drops'] as const

export default function StatisticsWorkspace() {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = readStatisticsTab(searchParams.get(STATISTICS_TAB_PARAM)) ?? DEFAULT_STATISTICS_TAB
  const command = useStatisticsCommands()

  // tab 切换只替换当前历史项，避免在浏览器历史里堆积同页的 tab 记录。
  const selectTab = useCallback((tab: ActiveTab) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (tab === DEFAULT_STATISTICS_TAB) {
        next.delete(STATISTICS_TAB_PARAM)
      } else {
        next.set(STATISTICS_TAB_PARAM, tab)
      }
      return next
    }, { replace: true })
  }, [setSearchParams])

  useResourceInvalidation(STATISTICS_RESOURCE_SCOPES, ({ resources, cause, detail }) => {
    // 本页识别命令在发布前已写入权威快照；只有携带该标记的发布才跳过自身重取。
    const recognizedSnapshotWritten = cause === 'recognition'
      && typeof detail === 'object'
      && detail !== null
      && (detail as { authoritativeSnapshot?: unknown }).authoritativeSnapshot === true
    if (resources.includes('depot') && !recognizedSnapshotWritten) {
      void queryClient.invalidateQueries({ queryKey: gameDataKeys.resource('depot') })
    }
    if (resources.includes('operbox') && !recognizedSnapshotWritten) {
      void queryClient.invalidateQueries({ queryKey: gameDataKeys.resource('operbox') })
    }
    if (resources.includes('catalog')) {
      void queryClient.invalidateQueries({ queryKey: gameDataKeys.resource('catalog') })
    }
    if (resources.includes('drops')) {
      void queryClient.invalidateQueries({ queryKey: statisticsKeys.resource('drops') })
    }
  })

  return (
    <SegmentedTabs value={activeTab} onValueChange={selectTab}>
      <StatisticsTabs activeTab={activeTab} />

      <div>
        <div className="min-w-0 app-stack-section">
          <SegmentedTabPanel value="operbox" id="data-statistics-panel-operbox" keepMounted>
            <OperatorPanel isActive={activeTab === 'operbox'} command={command} />
          </SegmentedTabPanel>
          <SegmentedTabPanel value="depot" id="data-statistics-panel-depot" keepMounted>
            <DepotPanel isActive={activeTab === 'depot'} command={command} />
          </SegmentedTabPanel>
          <SegmentedTabPanel value="drops" id="data-statistics-panel-drops" keepMounted>
            <DropPanel isActive={activeTab === 'drops'} />
          </SegmentedTabPanel>
        </div>
      </div>
    </SegmentedTabs>
  )
}
