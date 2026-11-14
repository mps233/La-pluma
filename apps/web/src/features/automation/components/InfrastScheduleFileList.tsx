import type { InfrastScheduleListPayload } from '../model/infrastSchedule'

interface InfrastScheduleFileListProps {
  directory: string
  schedules: InfrastScheduleListPayload['schedules']
  disabled: boolean
  onSelect: (name: string) => void
}

export default function InfrastScheduleFileList({ directory, schedules, disabled, onSelect }: InfrastScheduleFileListProps) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">目录：{directory}</p>
      {schedules.length > 0 ? (
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
          {schedules.map(schedule => (
            <button
              key={schedule.name}
              type="button"
              disabled={disabled}
              className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-2 text-left text-sm text-muted-foreground hover:bg-muted"
              onClick={() => onSelect(schedule.name)}
            >
              <span className="truncate">{schedule.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {schedule.valid ? `${schedule.planCount} 个方案` : '无法解析'}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">目录中还没有排班文件，填写文件名后点击“新建排班”。</p>
      )}
    </div>
  )
}
