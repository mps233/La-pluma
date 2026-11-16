import { PageShell } from '@/shared/components'
import { TrainingWorkspace } from '@/features/training'

export default function OperatorTraining() {
  return (
    <PageShell pageKind="training" layout="workspace">
      <TrainingWorkspace />
    </PageShell>
  )
}
