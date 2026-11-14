import { useRef, type KeyboardEvent } from 'react'
import { usePreviewStore, type PreviewMode } from '../store/previewStore'

const modes: { value: PreviewMode; label: string }[] = [
  { value: 'off', label: '关闭' },
  { value: 'snapshot', label: '快照' },
  { value: 'live', label: '实时' },
]

interface PreviewModeSegmentedProps {
  unavailable?: boolean
}

export function PreviewModeSegmented({ unavailable = false }: PreviewModeSegmentedProps) {
  const mode = usePreviewStore(state => state.mode)
  const setMode = usePreviewStore(state => state.setMode)
  const groupRef = useRef<HTMLDivElement | null>(null)
  const activeIndex = Math.max(0, modes.findIndex(option => option.value === mode))

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let nextIndex: number
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = (activeIndex - 1 + modes.length) % modes.length
        break
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = (activeIndex + 1) % modes.length
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = modes.length - 1
        break
      default:
        return
    }

    event.preventDefault()
    const next = modes[nextIndex]
    if (!next || (unavailable && next.value !== 'off')) return
    setMode(next.value)
    groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex]?.focus()
  }

  return (
    <div
      ref={groupRef}
      className="preview-mode-segmented"
      role="radiogroup"
      aria-label="预览模式"
      data-active-index={activeIndex}
      onKeyDown={handleKeyDown}
    >
      <span className="preview-mode-segmented-thumb" aria-hidden="true" />
      {modes.map(option => {
        const selected = mode === option.value
        const disabled = unavailable && option.value !== 'off' && !selected
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            title={disabled ? '自动化服务不可用' : undefined}
            onClick={() => setMode(option.value)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export default function PreviewModeControls({ unavailable = false }: { unavailable?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3.5">
      <PreviewModeSegmented unavailable={unavailable} />
    </div>
  )
}
