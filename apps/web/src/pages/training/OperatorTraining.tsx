import { PageHeader } from '@/shared/components'
import { FloatingStatusIndicator } from '@/features/runtime-status'
import { TrainingWorkspace } from '@/features/training'

export default function OperatorTraining() {
  return (
    <div className="app-page ios-workspace-page" data-page="training">
      <div className="app-stack-section">
        <PageHeader
          title="养成材料筹备"
          subtitle="管理材料目标并安排刷取计划；游戏内培养请在日常中添加任务"
          mobileLayout="inline"
          actions={<FloatingStatusIndicator />}
        />

        <TrainingWorkspace />
      </div>
    </div>
  )
}
