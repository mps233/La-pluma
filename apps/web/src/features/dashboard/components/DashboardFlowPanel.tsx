import { Activity, CalendarDays, Play } from 'lucide-react'
import { Button, Card } from '@/shared/components'
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
    connectionTitle,
    connectionDescription,
    quickStartLoading,
    feedback,
    runTodayFlow,
  } = useDashboardFlowActions({ refreshDashboard, onMissingFlow })

  const view = buildDashboardFlowView({
    automationAvailable: isAvailable,
    connectionTitle,
    connectionDescription,
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
    <div
      className={`dashboard-flow-glow-shell status-border-beam ${quickStartLoading || view.isRunning ? 'is-active' : ''}`}
      aria-busy={quickStartLoading || view.isRunning}
      data-dashboard-flow-card
    >
      <Card smoothCorners className="dashboard-flow-card p-0!">
      <div className="dashboard-flow-header">
        <div className="flex min-w-0 items-center gap-3.5">
          <div className="dashboard-flow-mark" aria-hidden="true">
            <Activity className="h-4 w-4" strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <div className="dashboard-flow-title text-base font-bold text-foreground">今日流程</div>
          </div>
        </div>
      </div>

      <div className="dashboard-flow-command" data-dashboard-flow-command>
        <div className="min-w-0">
          <div className={`text-xs font-medium ${labelClass}`}>{view.statusLabel}</div>
          <div className="mt-0.5 truncate text-xl font-bold text-foreground">{view.commandTitle}</div>
          <div className={`mt-1 truncate text-xs ${labelClass}`}>{view.commandDescription}</div>
        </div>
        <div className="dashboard-flow-actions">
          <Button
            onClick={runTodayFlow}
            variant="primary"
            disabled={view.controlsDisabled}
            loading={quickStartLoading}
            loadingText="启动中"
            statusKey={view.primaryActionStatusKey}
            className="dashboard-flow-primary-action dashboard-flow-shining-action justify-center whitespace-nowrap"
            icon={<Play className="h-4 w-4" strokeWidth={2} />}
          >
            {view.primaryActionLabel}
          </Button>
        </div>
      </div>

      {feedback.message && (
        <div
          className={`dashboard-flow-message is-${feedback.type} text-xs`}
          data-dashboard-flow-feedback
        >
          <span className="dashboard-flow-message-dot" aria-hidden="true" />
          <span className="min-w-0 flex-1">{feedback.message}</span>
        </div>
      )}

      <div className="dashboard-flow-activity" data-activity-status={activityView.phase}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <CalendarDays className="h-3.5 w-3.5 text-primary-strong" strokeWidth={1.8} aria-hidden="true" />
            <span className={`text-xs font-medium ${labelClass}`}>当前活动</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {activityView.phase === 'stale' && (
              <span className={mutedChipClass}>可能已过期</span>
            )}
            {activityView.canRetry && (
              <Button
                size="sm"
                variant="ghost"
                loading={isRefreshing}
                loadingText="刷新中"
                onClick={() => {
                  void refreshDashboard()
                }}
              >
                重试
              </Button>
            )}
          </div>
        </div>
        <div className="mt-2 wrap-break-word text-sm font-bold text-foreground">
          {activityView.title}
        </div>
        {activityView.detail && (
          <div className={`mt-0.5 wrap-break-word text-xs ${labelClass}`}>{activityView.detail}</div>
        )}
        {activityView.meta && (
          <div className={`mt-0.5 wrap-break-word text-[11px] ${labelClass}`}>{activityView.meta}</div>
        )}
        {activityView.activities && (
          <div className="mt-2 flex flex-wrap gap-1.5" data-activity-list>
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

      <div className="dashboard-flow-stages" data-dashboard-flow-stages>
        <div className="flex items-center justify-between gap-3.5">
          <div className="flex items-center gap-2">
            <span className="dashboard-flow-rail-dot" />
            <span className="text-xs font-semibold text-foreground">今日开放关卡</span>
          </div>
          <span className={`text-[11px] ${labelClass}`}>{openStageSummary.open.length} 个日常本</span>
        </div>
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
    </div>
  )
}
