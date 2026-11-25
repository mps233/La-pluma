import { SegmentedControl } from '@/shared/components'
import { usePreviewStore, type PreviewMode } from '../store/previewStore'

const modes: { value: PreviewMode; label: string }[] = [
  { value: 'off', label: '关闭' },
  { value: 'snapshot', label: '快照' },
  { value: 'live', label: '实时' },
]

export function PreviewModeSegmented({ unavailable = false }: { unavailable?: boolean }) {
  const mode = usePreviewStore(state => state.mode)
  const setMode = usePreviewStore(state => state.setMode)

  return (
    <SegmentedControl
      ariaLabel="预览模式"
      value={mode}
      options={modes.map(option => ({
        ...option,
        disabled: unavailable && option.value !== 'off',
      }))}
      onChange={setMode}
      itemClassName="min-h-7 min-w-11 text-xs sm:text-xs pointer-coarse:min-h-8"
    />
  )
}
