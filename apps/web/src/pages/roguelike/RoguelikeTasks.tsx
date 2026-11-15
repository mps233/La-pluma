import { RoguelikeWorkspace } from '@/features/roguelike'

export default function RoguelikeTasks() {
  return (
    <div className="app-page ios-workspace-page roguelike-page" data-workbench-tasks data-page="roguelike">
      <div className="app-stack-section">
        <RoguelikeWorkspace />
      </div>
    </div>
  )
}
