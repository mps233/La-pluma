import { AutomationSkeleton } from './AutomationTasksSkeleton'
import { CombatSkeleton } from './CombatTasksSkeleton'
import { ConfigSkeleton } from './ConfigManagerSkeleton'
import { StatisticsSkeleton } from './DataStatisticsSkeleton'
import { DashboardSkeleton } from './DashboardSkeleton'
import { LogsSkeleton } from './LogViewerSkeleton'
import { TrainingSkeleton } from './OperatorTrainingSkeleton'
import { RoguelikeSkeleton } from './RoguelikeTasksSkeleton'
import { PageHeaderSkeleton } from './common/Skeleton'

export function PageSkeleton({ variant }: { variant: string }) {
  if (variant === 'dashboard') return <DashboardSkeleton />

  const pageClassNames = [
    'app-page',
    'ios-workspace-page',
    ['training', 'logs', 'statistics', 'config'].includes(variant) ? 'ios-borderless-cards' : '',
    variant === 'combat' ? 'combat-page' : '',
    variant === 'roguelike' ? 'roguelike-page' : '',
    variant === 'logs' ? 'log-viewer' : '',
    variant === 'statistics' ? 'data-statistics-page' : '',
    variant === 'config' ? 'app-stack-section' : '',
  ].filter(Boolean).join(' ')

  const pageContent = (
    <>
      <PageHeaderSkeleton />
      {variant === 'automation' && <AutomationSkeleton />}
      {variant === 'combat' && <CombatSkeleton />}
      {variant === 'roguelike' && <RoguelikeSkeleton />}
      {variant === 'training' && <TrainingSkeleton />}
      {variant === 'logs' && <LogsSkeleton />}
      {variant === 'statistics' && <StatisticsSkeleton />}
      {variant === 'config' && <ConfigSkeleton />}
    </>
  )

  return (
    <div
      className={pageClassNames}
      data-automation-tasks={variant === 'automation' ? true : undefined}
      data-workbench-tasks={variant === 'combat' || variant === 'roguelike' ? true : undefined}
      data-page={variant === 'training' || variant === 'config' ? variant : undefined}
      aria-busy="true"
      aria-label="页面内容加载中"
    >
      {variant === 'config' ? pageContent : <div className="app-stack-section">{pageContent}</div>}
    </div>
  )
}

