import { PageShell } from '@/shared/components'
import { RoguelikeWorkspace } from '@/features/roguelike'

export default function RoguelikeTasks() {
  return (
    <PageShell pageKind="roguelike" layout="workspace" surface="borderless" className="roguelike-page">
      <RoguelikeWorkspace />
    </PageShell>
  )
}
