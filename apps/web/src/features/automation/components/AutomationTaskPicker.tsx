import { useState, type RefObject } from 'react'
import { Menu as MenuPrimitive } from '@base-ui/react/menu'
import { Plus } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import type { AutomationAvailableTask, TaskFlowItem } from '../types'
import { AVAILABLE_TASKS } from './automationTaskCatalog'

interface AutomationTaskPickerProps {
  flow: readonly TaskFlowItem[]
  disabled: boolean
  onAddTask: (task: AutomationAvailableTask) => void
  /** 页面把整条流程页脚传入：区域内按下指针不关闭菜单，保持原关闭区域。 */
  regionRef: RefObject<HTMLDivElement | null>
}

export default function AutomationTaskPicker({
  flow,
  disabled,
  onAddTask,
  regionRef,
}: AutomationTaskPickerProps) {
  const [open, setOpen] = useState(false)

  if (disabled && open) setOpen(false)
  const isOpen = open && !disabled

  const handleOpenChange = (
    nextOpen: boolean,
    eventDetails: MenuPrimitive.Root.ChangeEventDetails,
  ) => {
    if (
      !nextOpen
      && eventDetails.reason === 'outside-press'
      && eventDetails.event.target instanceof Node
      && regionRef.current?.contains(eventDetails.event.target)
    ) {
      eventDetails.cancel()
      return
    }
    setOpen(nextOpen)
  }

  const selectTask = (task: AutomationAvailableTask) => {
    onAddTask(task)
    setOpen(false)
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={handleOpenChange} modal={false}>
      <DropdownMenuTrigger
        className="automation-task-picker-toggle"
        disabled={disabled}
      >
        <Plus size={16} strokeWidth={2.1} />
        <span>添加任务</span>
        <small>{AVAILABLE_TASKS.length}</small>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        data-page-kind="automation"
        aria-label="可添加任务"
        className="automation-task-picker max-h-[min(14rem,var(--available-height))] gap-0 rounded-xl bg-(--automation-picker-surface) p-1.5 shadow-(--automation-overlay-shadow) ring-0"
      >
        {AVAILABLE_TASKS.map(task => {
          const addedCount = flow.filter(flowTask => flowTask.commandId === task.id).length

          return (
            <DropdownMenuItem
              key={task.id}
              onClick={() => selectTask(task)}
              className="automation-task-picker-option grid cursor-pointer gap-2 rounded-none px-2 py-1.5 text-left"
            >
              <span>{task.icon}</span>
              <strong>{task.name}</strong>
              {addedCount > 0 && <small>{addedCount}</small>}
              <Plus size={14} strokeWidth={2} />
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
