import { ChevronRight } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { useDashboardStore } from '../store/dashboardStore'
import { useFittedDropItems } from '../hooks/useFittedDropItems'

const sectionTitleClass = 'text-base font-bold text-foreground'

interface DashboardDropSummaryCardProps {
  onOpenStatistics: () => void
}

export default function DashboardDropSummaryCard({ onOpenStatistics }: DashboardDropSummaryCardProps) {
  const dropSummary = useDashboardStore(state => state.dropSummary)
  const dropItemsText = dropSummary.count > 0
    ? (dropSummary.items ?? dropSummary.recent.map(record => record.items).join('、'))
    : ''
  const { containerRef, visible, truncated } = useFittedDropItems(dropItemsText)

  return (
    <Card className="dashboard-summary-card is-drops gap-0 p-0!">
      <div className="dashboard-summary-header">
        <div className="dashboard-summary-heading">
          <div className="min-w-0">
            <div className={sectionTitleClass}>今日掉落摘要</div>
          </div>
        </div>
        <Button
          onClick={onOpenStatistics}
          size="icon-sm"
          variant="ghost"
          title="打开数据"
          aria-label="打开数据"
          className="dashboard-summary-action"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="dashboard-summary-body">
        <div className="dashboard-summary-statline">
          <div>
            <div className="dashboard-summary-number">{dropSummary.count}</div>
            <div className="dashboard-summary-number-label">掉落记录</div>
          </div>
          <div className="dashboard-summary-copy">
            <div className="text-sm font-semibold text-foreground">{dropSummary.count > 0 ? '今日已记录' : '尚无作战产出'}</div>
            <div className="dashboard-summary-detail">
              {dropSummary.count > 0 ? '最近的关卡与材料已完成汇总' : '完成作战后会自动记录关卡与材料'}
            </div>
          </div>
        </div>
        <div className={`dashboard-summary-footer${dropSummary.count === 0 ? ' is-action' : ''}`}>
          {dropSummary.count > 0 ? (
            <div ref={containerRef} className="dashboard-drop-list">
              <span className="dashboard-drop-items">
                {visible.join('、')}{truncated ? (visible.length > 0 ? '、…' : '…') : ''}
              </span>
            </div>
          ) : (
            <button type="button" onClick={onOpenStatistics} className="dashboard-summary-link min-h-11">
              查看掉落数据
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </Card>
  )
}
