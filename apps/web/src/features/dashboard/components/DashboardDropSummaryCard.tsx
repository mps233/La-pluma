import { ChevronRight, PackageOpen } from 'lucide-react'
import { Card, IconButton } from '@/shared/components'
import { useDashboardStore } from '../store/dashboardStore'

const sectionTitleClass = 'text-base font-bold text-foreground'

interface DashboardDropSummaryCardProps {
  onOpenStatistics: () => void
}

export default function DashboardDropSummaryCard({ onOpenStatistics }: DashboardDropSummaryCardProps) {
  const dropSummary = useDashboardStore(state => state.dropSummary)

  return (
    <Card smoothCorners className="dashboard-summary-card is-drops p-0!">
      <div className="dashboard-summary-header">
        <div className="dashboard-summary-heading">
          <span className="dashboard-summary-icon" aria-hidden="true">
            <PackageOpen className="h-4 w-4" strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <div className={sectionTitleClass}>今日掉落摘要</div>
          </div>
        </div>
        <IconButton
          onClick={onOpenStatistics}
          icon={<ChevronRight className="h-4 w-4" />}
          variant="ghost"
          size="sm"
          title="打开数据"
          aria-label="打开数据"
          className="dashboard-summary-action"
        />
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
            <div className="dashboard-drop-list">
              {dropSummary.recent.map((record, index) => (
                <div key={`${record.stage}-${index}`} className="dashboard-drop-row">
                  <span className="dashboard-drop-stage">{record.stage}</span>
                  <span className="dashboard-drop-items">{record.items}</span>
                </div>
              ))}
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
