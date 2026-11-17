import { LoaderCircle, Play } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { Separator } from '@/shared/ui/separator'
import { useDashboardStore } from '../store/dashboardStore'
import { useDashboardFlowActions } from '../hooks/useDashboardFlowActions'
import { buildDashboardFlowView } from '../model/flowView'
import { buildDashboardActivityView } from '../model/activityView'

const labelClass = 'text-muted-foreground'
const dashboardChipClass = 'brand-chip rounded-lg px-2.5 py-1 text-xs font-medium'
const mutedChipClass = 'rounded-lg px-2.5 py-1 surface-soft text-muted-foreground text-xs'

interface DashboardFlowPanelProps {
  refreshDashboard: () => Promise<void>
  onMissingFlow: () => void
}

export default function DashboardFlowPanel({ refreshDashboard, onMissingFlow }: DashboardFlowPanelProps) {
  const activitySummary = useDashboardStore(state => state.activitySummary)
  const scheduleSummary = useDashboardStore(state => state.scheduleSummary)
  const openStageSummary = useDashboardStore(state => state.openStageSummary)
  const lastUpdate = useDashboardStore(state => state.lastUpdate)
  const lastRefreshError = useDashboardStore(state => state.lastRefreshError)
  const isRefreshing = useDashboardStore(state => state.isRefreshing)
  const {
    status,
    isBusy,
    observationError,
    isAvailable,
    connectionChecking,
    quickStartLoading,
    runTodayFlow,
  } = useDashboardFlowActions({ refreshDashboard, onMissingFlow })

  const view = buildDashboardFlowView({
    automationAvailable: isAvailable,
    connectionChecking,
    quickStartLoading,
    deviceBusy: isBusy,
    phase: status.phase,
    runLabel: status.label,
    runDetail: status.detail,
    currentTask: scheduleSummary.currentTask,
    scheduleMessage: scheduleSummary.message,
    observationError,
  })
  const activityView = buildDashboardActivityView({
    summary: activitySummary,
    hasSnapshot: lastUpdate !== null,
    isRefreshing,
    lastRefreshFailed: lastRefreshError !== null,
    lastRefreshError,
    lastUpdate,
  })

  return (
    <Card
      className="dashboard-flow-card gap-0 p-0!"
      aria-busy={quickStartLoading || view.isRunning}
      data-dashboard-flow-card
    >
      <div className="dashboard-flow-command" data-dashboard-flow-command>
        <div className="min-w-0">
          <div className="truncate text-xl font-bold text-foreground">{view.commandTitle}</div>
          <div className={`mt-1 truncate text-xs ${labelClass}`}>{view.commandDescription}</div>
        </div>
        <div className="dashboard-flow-actions">
          <Button
            onClick={runTodayFlow}
            disabled={view.controlsDisabled || quickStartLoading}
            aria-busy={quickStartLoading || undefined}
            className="dashboard-flow-primary-action justify-center whitespace-nowrap"
          >
            {quickStartLoading
              ? <><LoaderCircle className="animate-spin" aria-hidden="true" />启动中</>
              : (
                <>
                  <Play className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                  {view.primaryActionLabel}
                </>
              )}
          </Button>
        </div>
      </div>

      <Separator />

      <div className="dashboard-flow-activity" data-activity-status={activityView.phase}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="wrap-break-word text-sm font-bold text-foreground">{activityView.title}</span>
          {activityView.duration && (
            <span className="text-xs text-muted-foreground">{activityView.duration}</span>
          )}
        </div>
        {activityView.detail && (
          <div className={`mt-0.5 wrap-break-word text-xs ${labelClass}`}>{activityView.detail}</div>
        )}
        {activityView.meta && (
          <div className={`mt-0.5 wrap-break-word text-[11px] ${labelClass}`}>{activityView.meta}</div>
        )}
        {activityView.activities && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {activityView.activities.map((activity, index) => (
              <span
                key={`${activity.title}-${index}`}
                className={activity.rerun ? dashboardChipClass : mutedChipClass}
              >
                {activity.rerun ? '复刻 · ' : ''}{activity.title}
                {activity.detail ? ` · ${activity.detail}` : ''}
              </span>
            ))}
          </div>
        )}
      </div>

      <Separator />

      <div className="dashboard-flow-stages" data-dashboard-flow-stages>
        <span className="text-xs font-semibold text-foreground">今日开放资源关卡</span>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {openStageSummary.open.length > 0 ? (
            openStageSummary.open.map(item => (
              <span key={item.stage} className={dashboardChipClass}>{item.stage} · {item.name}</span>
            ))
          ) : (
            <span className={mutedChipClass}>等待开放关卡数据</span>
          )}
        </div>
      </div>

    </Card>
  )
}
