import { motion, useReducedMotion } from 'framer-motion'
import Icons from '@/shared/components/Icons'
import { useFluidTabIndicator } from '@/shared/hooks/useFluidTabIndicator'
import { ROGUELIKE_TASKS } from '../model/roguelikeTasks'
import type { RoguelikeMode } from '../types'

interface RoguelikeModePanelProps {
  activeMode: RoguelikeMode
  onModeChange: (mode: RoguelikeMode) => void
}

export default function RoguelikeModePanel({ activeMode, onModeChange }: RoguelikeModePanelProps) {
  const shouldReduceMotion = useReducedMotion()
  const {
    containerRef,
    activeRect,
    setTabRef,
    handleTabKeyDown,
  } = useFluidTabIndicator(activeMode)
  const modes = ROGUELIKE_TASKS.map(task => task.id)

  return (
    <div className="roguelike-mode-area">
      <div className="app-workspace-segments app-liquid-tab-pill roguelike-mode-shell">
        <div
          ref={containerRef}
          className="app-workspace-segment-list roguelike-mode-tabs"
          role="toolbar"
          aria-label="肉鸽模式"
        >
          {activeRect.width > 0 && (
            <motion.div
              data-testid="roguelike-mode-highlight"
              aria-hidden="true"
              className="app-workspace-segment-indicator roguelike-mode-highlight"
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
          {ROGUELIKE_TASKS.map(task => {
            const IconComponent = Icons[task.icon as keyof typeof Icons]
            const selected = activeMode === task.id
            return (
              <button
                key={task.id}
                ref={(element) => {
                  setTabRef(task.id)(element)
                }}
                type="button"
                onClick={() => onModeChange(task.id)}
                onKeyDown={(event) => handleTabKeyDown(event, modes, onModeChange)}
                aria-pressed={selected}
                tabIndex={selected ? 0 : -1}
                className={`app-workspace-segment roguelike-mode-button min-h-11 ${selected ? 'is-selected' : ''}`}
              >
                {IconComponent && (
                  <span className="app-workspace-segment-icon roguelike-mode-icon">
                    <IconComponent />
                  </span>
                )}
                <span className="app-workspace-segment-copy">
                  <span>{task.name}</span>
                  <small>{task.description}</small>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
