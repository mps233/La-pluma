import { Download, Pause, Play, Search, Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, Input, Select, Switch } from '@/shared/components'
import type { LogEventFilter, LogFilter } from '../model/logModel'

interface LogsToolbarProps {
  readonly autoScroll: boolean
  readonly onAutoScrollChange: (value: boolean) => void
  readonly runId: string
  readonly runIds: readonly string[]
  readonly onRunIdChange: (value: string) => void
  readonly events: LogEventFilter
  readonly onEventsChange: (value: LogEventFilter) => void
  readonly collapseRepeats: boolean
  readonly onCollapseRepeatsChange: (value: boolean) => void
  readonly filter: LogFilter
  readonly onFilterChange: (filter: LogFilter) => void
  readonly search: string
  readonly onSearchChange: (value: string) => void
  readonly viewingHistory: boolean
  readonly paused: boolean
  readonly onTogglePause: () => void
  readonly actionBusy: boolean
  readonly canExport: boolean
  readonly onClear: () => void
  readonly onExport: () => void
}

export default function LogsToolbar({
  autoScroll,
  onAutoScrollChange,
  runId,
  runIds,
  onRunIdChange,
  events,
  onEventsChange,
  collapseRepeats,
  onCollapseRepeatsChange,
  filter,
  onFilterChange,
  search,
  onSearchChange,
  viewingHistory,
  paused,
  onTogglePause,
  actionBusy,
  canExport,
  onClear,
  onExport,
}: LogsToolbarProps) {
  return (
    <Card className="log-card log-toolbar-card p-0!" smoothCorners>
      <CardContent className="log-toolbar">
        <div className="log-toolbar-controls">
          <div className={`log-toggle-control flex min-h-11 min-w-0 items-center justify-between gap-3.5 ${viewingHistory ? 'opacity-50' : ''}`}>
            <span className="truncate text-xs font-medium text-muted-foreground">自动滚动</span>
            <Switch
              compact
              checked={autoScroll}
              onChange={onAutoScrollChange}
              label="自动滚动"
              disabled={viewingHistory}
            />
          </div>
          <div className="log-toggle-control flex min-h-11 min-w-0 items-center justify-between gap-3.5">
            <span className="truncate text-xs font-medium text-muted-foreground">折叠重复</span>
            <Switch
              compact
              checked={collapseRepeats}
              onChange={onCollapseRepeatsChange}
              label="折叠重复日志"
            />
          </div>
          <Select
            value={runId}
            onChange={onRunIdChange}
            aria-label="执行范围"
            className="col-span-2 w-full sm:col-auto sm:w-56"
            disabled={viewingHistory}
            options={[
              { value: '', label: '全部执行与未关联日志' },
              ...runIds.map(id => ({ value: id, label: `Run · ${id}` })),
            ]}
          />
          <Select
            value={events}
            onChange={value => onEventsChange(value as LogEventFilter)}
            aria-label="事件范围"
            className="w-full sm:w-36"
            options={[
              { value: 'key', label: '关键事件' },
              { value: 'all', label: '全部事件' },
            ]}
          />
          <Select
            value={filter}
            onChange={value => onFilterChange(value as LogFilter)}
            aria-label="日志级别"
            className="w-full sm:w-36"
            options={[
              { value: 'all', label: '全部级别' },
              { value: 'ERROR', label: '错误' },
              { value: 'WARN', label: '警告' },
              { value: 'INFO', label: '信息' },
              { value: 'DEBUG', label: '调试' },
            ]}
          />
          <Input
            value={search}
            onChange={onSearchChange}
            placeholder="搜索日志内容"
            aria-label="搜索日志内容"
            icon={<Search className="h-4 w-4" aria-hidden="true" />}
            className="col-span-2 w-full sm:col-auto sm:min-w-56 sm:flex-1"
          />
        </div>
        <div className="log-toolbar-actions">
          {!viewingHistory && (
            <Button
              onClick={onTogglePause}
              variant="outline"
              size="sm"
              disabled={actionBusy}
              aria-label={paused ? '继续读取日志' : '暂停读取日志'}
            >
              {paused
                ? <Play className="h-4 w-4" aria-hidden="true" />
                : <Pause className="h-4 w-4" aria-hidden="true" />}
              {paused ? '继续' : '暂停'}
            </Button>
          )}
          {!viewingHistory && (
            <Button
              onClick={onClear}
              variant="outline"
              size="sm"
              disabled={actionBusy}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              清屏
            </Button>
          )}
          <Button
            onClick={onExport}
            size="sm"
            disabled={!canExport}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            导出筛选结果
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
