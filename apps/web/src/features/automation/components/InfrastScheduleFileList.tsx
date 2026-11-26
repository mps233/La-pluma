import { EmptyState } from '@/shared/components'
import { Badge } from '@/shared/ui/badge'
import { Item, ItemActions, ItemContent, ItemTitle } from '@/shared/ui/item'
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
        <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-2">
          {schedules.map(schedule => (
            <Item
              key={schedule.name}
              size="sm"
              render={(
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelect(schedule.name)}
                />
              )}
              className="min-h-11 cursor-pointer px-2 py-1.5 text-left hover:bg-muted focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-50"
            >
              <ItemContent className="min-w-0">
                <ItemTitle className="w-full min-w-0 font-normal text-muted-foreground">{schedule.name}</ItemTitle>
              </ItemContent>
              <ItemActions>
                <Badge variant={schedule.valid ? 'secondary' : 'destructive'}>
                  {schedule.valid ? `${schedule.planCount} 个方案` : '无法解析'}
                </Badge>
              </ItemActions>
            </Item>
          ))}
        </div>
      ) : (
        <EmptyState compact title="目录中还没有排班文件" description="填写文件名后点击“新建排班”。" />
      )}
    </div>
  )
}
