import { useId, useMemo, type KeyboardEvent } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Camera, EyeOff, Radio } from 'lucide-react'
import { usePreviewStore, type PreviewMode } from '../stores'
import { useFluidTabIndicator } from '../hooks/useFluidTabIndicator'
import { Switch } from './common'

const PREVIEW_MODES: ReadonlyArray<{
  value: PreviewMode
  label: string
  description: string
  Icon: typeof EyeOff
}> = [
  { value: 'off', label: '关闭', description: '不连接', Icon: EyeOff },
  { value: 'snapshot', label: '快照', description: '10 秒刷新', Icon: Camera },
  { value: 'live', label: '实时', description: '低延迟画面', Icon: Radio },
]

interface PreviewModeControlsProps {
  compact?: boolean
  className?: string
}

/**
 * 预览模式开关，复用工作区液体分段控件的结构与动效。
 * 模式只在当前会话内保留；自动恢复是单独的显式偏好。
 */
export function PreviewModeControls({
  compact = false,
  className = '',
}: PreviewModeControlsProps) {
  const shouldReduceMotion = useReducedMotion()
  const mode = usePreviewStore(state => state.mode)
  const setMode = usePreviewStore(state => state.setMode)
  const values = useMemo(() => PREVIEW_MODES.map(option => option.value), [])
  const {
    containerRef,
    activeRect,
    setTabRef,
  } = useFluidTabIndicator(mode)

  const handleModeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = Math.max(0, values.indexOf(mode))
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % values.length
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + values.length) % values.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = values.length - 1
    }
    const nextMode = nextIndex === null ? undefined : values[nextIndex]
    if (!nextMode) return
    event.preventDefault()
    setMode(nextMode)
    containerRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex!]
      ?.focus({ preventScroll: true })
  }

  return (
    <div className={`app-workspace-segments app-liquid-tab-pill preview-mode-shell${compact ? ' is-compact' : ''} ${className}`.trim()}>
      <div
        ref={containerRef}
        className="app-workspace-segment-list preview-mode-list"
        role="radiogroup"
        aria-label="预览模式"
        onKeyDown={handleModeKeyDown}
      >
        {activeRect.width > 0 && (
          <motion.span
            aria-hidden="true"
            className="app-workspace-segment-indicator preview-mode-highlight"
            initial={false}
            animate={{
              x: activeRect.x,
              y: activeRect.y,
              width: activeRect.width,
              height: activeRect.height,
            }}
            transition={shouldReduceMotion
              ? { duration: 0 }
              : { type: 'spring', stiffness: 420, damping: 38, mass: 0.72 }}
          />
        )}
        {PREVIEW_MODES.map(option => {
          const selected = mode === option.value
          const Icon = option.Icon
          return (
            <button
              key={option.value}
              ref={setTabRef(option.value)}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-pressed={selected}
              tabIndex={selected ? 0 : -1}
              title={option.description}
              onClick={() => setMode(option.value)}
              className={`app-workspace-segment preview-mode-option min-h-11 ${selected ? 'is-selected' : ''}`}
            >
              <span className="app-workspace-segment-icon" aria-hidden="true">
                <Icon strokeWidth={1.8} />
              </span>
              <span className="app-workspace-segment-copy">
                <span>{option.label}</span>
                <small>{option.description}</small>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** 重新打开应用后是否恢复上次模式；默认关闭。 */
export function PreviewAutoStartSetting({ compact = false }: { compact?: boolean }) {
  const autoStart = usePreviewStore(state => state.autoStart)
  const setAutoStart = usePreviewStore(state => state.setAutoStart)
  const inputId = `preview-auto-start-${useId().replace(/:/g, '')}`

  return (
    <div className={`flex items-center justify-between gap-4${compact ? ' text-xs' : ''}`}>
      <label htmlFor={inputId} className="min-w-0 cursor-pointer">
        <span className="block font-medium text-primary">重新打开时恢复预览</span>
        <span className="mt-0.5 block leading-5 text-secondary">默认关闭；仅在重新打开应用后生效</span>
      </label>
      <Switch
        id={inputId}
        compact
        label="重新打开时恢复预览"
        checked={autoStart}
        onChange={setAutoStart}
      />
    </div>
  )
}

export default PreviewModeControls
