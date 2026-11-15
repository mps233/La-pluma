import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Plus } from 'lucide-react'
import type { AutomationAvailableTask, TaskFlowItem } from '../types'
import { AVAILABLE_TASKS } from './automationTaskCatalog'

interface AutomationTaskPickerProps {
  flow: readonly TaskFlowItem[]
  disabled: boolean
  onAddTask: (task: AutomationAvailableTask) => void
  /** 页面把整条流程页脚传入：区域内按下指针不关闭菜单，保持原关闭区域。 */
  regionRef: RefObject<HTMLDivElement | null>
}

interface TaskPickerMenuPosition {
  left: number
  width: number
  maxHeight: number
  top?: number
  bottom?: number
  placement: 'top' | 'bottom'
}

const MENU_GAP = 8
const VIEWPORT_MARGIN = 12
const MENU_MAX_HEIGHT = 224
const MENU_OPTION_HEIGHT = 44

export default function AutomationTaskPicker({
  flow,
  disabled,
  onAddTask,
  regionRef,
}: AutomationTaskPickerProps) {
  const shouldReduceMotion = useReducedMotion()
  const [open, setOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<TaskPickerMenuPosition | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return

    const rect = trigger.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const width = Math.max(0, Math.min(rect.width, viewportWidth - VIEWPORT_MARGIN * 2))
    const left = Math.min(
      Math.max(rect.left, VIEWPORT_MARGIN),
      Math.max(VIEWPORT_MARGIN, viewportWidth - VIEWPORT_MARGIN - width),
    )
    const naturalHeight = Math.min(AVAILABLE_TASKS.length * MENU_OPTION_HEIGHT + 12, MENU_MAX_HEIGHT)
    const navbarBottom = document.querySelector<HTMLElement>('[data-region="navbar"]')
      ?.getBoundingClientRect().bottom ?? 0
    const topInset = Math.max(VIEWPORT_MARGIN, navbarBottom)
    const spaceAbove = Math.max(0, rect.top - MENU_GAP - topInset)
    const spaceBelow = Math.max(0, viewportHeight - rect.bottom - MENU_GAP - VIEWPORT_MARGIN)
    const placement = spaceAbove >= naturalHeight || spaceAbove >= spaceBelow ? 'top' : 'bottom'
    const maxHeight = Math.max(0, Math.min(naturalHeight, placement === 'top' ? spaceAbove : spaceBelow))

    setMenuPosition({
      left,
      width,
      maxHeight,
      placement,
      ...(placement === 'top'
        ? { bottom: viewportHeight - rect.top + MENU_GAP }
        : { top: rect.bottom + MENU_GAP }),
    })
  }, [])

  // 运行态不能编辑：在渲染期收敛为关闭，避免 Effect 内级联 setState。
  if (disabled && open) setOpen(false)
  const isOpen = open && !disabled

  useEffect(() => {
    if (!isOpen) return

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!regionRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    const repositionOnScroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return
      updateMenuPosition()
    }

    document.addEventListener('pointerdown', closeOnOutsidePress)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', repositionOnScroll, true)
    updateMenuPosition()
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', repositionOnScroll, true)
    }
  }, [isOpen, regionRef, updateMenuPosition])

  const selectTask = (task: AutomationAvailableTask) => {
    onAddTask(task)
    setOpen(false)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`automation-task-picker-toggle${isOpen ? ' is-open' : ''}`}
        onClick={() => {
          if (isOpen) {
            setOpen(false)
            return
          }
          updateMenuPosition()
          setOpen(true)
        }}
        disabled={disabled}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-controls="automation-task-picker"
      >
        <Plus size={16} strokeWidth={2.1} />
        <span>添加任务</span>
        <small>{AVAILABLE_TASKS.length}</small>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && menuPosition && (
          <motion.div
            ref={menuRef}
            id="automation-task-picker"
            role="menu"
            aria-label="可添加任务"
            className="automation-task-picker"
            data-placement={menuPosition.placement}
            style={{
              top: menuPosition.top,
              bottom: menuPosition.bottom,
              left: menuPosition.left,
              width: menuPosition.width,
              maxHeight: menuPosition.maxHeight,
            }}
            initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: shouldReduceMotion ? 0.12 : 0.32, ease: [0.32, 0.72, 0, 1] }}
          >
            {AVAILABLE_TASKS.map(task => {
              const addedCount = flow.filter(flowTask => flowTask.commandId === task.id).length

              return (
                <button
                  key={task.id}
                  type="button"
                  role="menuitem"
                  onClick={() => selectTask(task)}
                  className="automation-task-picker-option"
                >
                  <span>{task.icon}</span>
                  <strong>{task.name}</strong>
                  {addedCount > 0 && <small>{addedCount}</small>}
                  <Plus size={14} strokeWidth={2} />
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
