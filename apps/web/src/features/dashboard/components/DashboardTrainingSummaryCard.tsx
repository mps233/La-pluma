import { ChevronRight } from 'lucide-react'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { useDashboardStore } from '../store/dashboardStore'

const sectionTitleClass = 'text-base font-bold text-foreground'

interface DashboardTrainingSummaryCardProps {
  onOpenTraining: () => void
}

export default function DashboardTrainingSummaryCard({ onOpenTraining }: DashboardTrainingSummaryCardProps) {
  const trainingSummary = useDashboardStore(state => state.trainingSummary)

  return (
    <Card className="dashboard-summary-card is-training gap-0 p-0!">
      <div className="dashboard-summary-header">
        <div className="dashboard-summary-heading">
          <div className="min-w-0">
            <div className={sectionTitleClass}>养成摘要</div>
          </div>
        </div>
        <Button
          onClick={onOpenTraining}
          size="icon-sm"
          variant="ghost"
          title="打开养成"
          aria-label="打开养成"
          className="dashboard-summary-action"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="dashboard-summary-body" data-dashboard-summary="training">
        <div className="dashboard-summary-statline">
          <div>
            <div className="dashboard-summary-number" data-dashboard-summary-number>{trainingSummary.count}</div>
            <div className="dashboard-summary-number-label">培养目标</div>
          </div>
          <div className="dashboard-summary-copy">
            <div className="text-sm font-semibold text-foreground">{trainingSummary.count > 0 ? '队列已建立' : '等待添加目标'}</div>
            <div className="dashboard-summary-detail">
              {trainingSummary.count > 0 ? '按优先级推进当前培养计划' : '添加干员后会在这里汇总优先目标'}
            </div>
          </div>
        </div>
        <div className={`dashboard-summary-footer${trainingSummary.topNames.length === 0 ? ' is-action' : ''}`}>
          {trainingSummary.topNames.length > 0 ? (
            <div className="dashboard-stage-list">
              {trainingSummary.topNames.map(name => (
                <Badge
                  key={name}
                  variant="ghost"
                  className="dashboard-stage-chip is-accent rounded-lg border-0 px-2 py-1 font-semibold hover:text-foreground"
                >
                  {name}
                </Badge>
              ))}
            </div>
          ) : (
            <button type="button" onClick={onOpenTraining} className="dashboard-summary-link min-h-11">
              添加首个培养目标
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </Card>
  )
}
