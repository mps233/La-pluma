import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/shared/ui/button'
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
}

export default function AutomationTaskPicker({
  flow,
  disabled,
  onAddTask,
}: AutomationTaskPickerProps) {
  const [open, setOpen] = useState(false)

  if (disabled && open) setOpen(false)
  const isOpen = open && !disabled

  const selectTask = (task: AutomationAvailableTask) => {
    onAddTask(task)
    setOpen(false)
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger
        render={<Button type="button" variant="ghost" size="icon" />}
        aria-label="添加任务"
        title="添加任务"
        disabled={disabled}
      >
        <Plus size={16} strokeWidth={2.1} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="bottom"
        align="end"
        sideOffset={8}
        collisionPadding={12}
        aria-label="可添加任务"
        className="max-h-[min(14rem,var(--available-height))] w-60"
      >
        {AVAILABLE_TASKS.map(task => {
          const addedCount = flow.filter(flowTask => flowTask.commandId === task.id).length

          return (
            <DropdownMenuItem
              key={task.id}
              onClick={() => selectTask(task)}
              className="automation-task-picker-option grid cursor-pointer gap-2 px-2 py-1.5 text-left"
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
