import type { ReactNode } from 'react'
import { usePanelState } from '../hooks/usePanelState'
import type { CopilotPreviewMode } from '../model/copilotPreview'
import type { PanelStateStore } from '../model/panelState'
import CombatCopilotInputPanel from './CombatCopilotInputPanel'
import CombatCopilotDiscoveryDialog from './CombatCopilotDiscoveryDialog'
import type {
  CombatCopilotFileImportProjection,
  CombatCopilotSearchProjection,
} from './combatPanelTypes'

interface CombatCopilotSourceBarProps {
  input: string
  isLoading: boolean
  isAddingToQueue?: boolean
  previewModeStore: PanelStateStore<CopilotPreviewMode>
  search: CombatCopilotSearchProjection
  fileImport?: CombatCopilotFileImportProjection
  onInputChange: (value: string) => void
  onPreview: () => void
  onAddToQueue?: () => void
  onCancelPreview: () => void
  detailLayer?: ReactNode
}

export default function CombatCopilotSourceBar({
  input,
  isLoading,
  isAddingToQueue = false,
  previewModeStore,
  search,
  fileImport,
  onInputChange,
  onPreview,
  onAddToQueue,
  onCancelPreview,
  detailLayer,
}: CombatCopilotSourceBarProps) {
  const [previewMode, setPreviewMode] = usePanelState(previewModeStore)

  const handlePreviewModeChange = (mode: CopilotPreviewMode) => {
    onCancelPreview()
    setPreviewMode(mode)
  }

  return (
    <section className="combat-copilot-source-bar" aria-label="作业来源">
      <CombatCopilotInputPanel
        input={input}
        isLoading={isLoading}
        isAddingToQueue={isAddingToQueue}
        previewMode={previewMode}
        fileImport={fileImport}
        onInputChange={onInputChange}
        onPreviewModeChange={handlePreviewModeChange}
        onPreview={onPreview}
        onAddToQueue={onAddToQueue}
        onOpenDiscovery={search.onOpen}
      />

      <CombatCopilotDiscoveryDialog search={search}>{detailLayer}</CombatCopilotDiscoveryDialog>
    </section>
  )
}
