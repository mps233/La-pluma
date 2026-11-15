import { Download, Pause, Play, Search, Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Switch } from '@/shared/ui/switch'
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
    <Card className="log-card log-toolbar-card gap-0 p-0!">
      <CardContent className="log-toolbar">
        <div className="log-toolbar-controls">
          <div className={`log-toggle-control flex min-h-11 min-w-0 items-center justify-between gap-3.5 ${viewingHistory ? 'opacity-50' : ''}`}>
            <span className="truncate text-xs font-medium text-muted-foreground">自动滚动</span>
            <Switch
              size="sm"
              checked={autoScroll}
              onCheckedChange={onAutoScrollChange}
              aria-label="自动滚动"
              disabled={viewingHistory}
            />
          </div>
          <div className="log-toggle-control flex min-h-11 min-w-0 items-center justify-between gap-3.5">
            <span className="truncate text-xs font-medium text-muted-foreground">折叠重复</span>
            <Switch
              size="sm"
              checked={collapseRepeats}
              onCheckedChange={onCollapseRepeatsChange}
              aria-label="折叠重复日志"
            />
          </div>
          <Select
            value={runId}
            onValueChange={(next, details) => { if (details.reason !== 'none' && next !== null) onRunIdChange(next) }}
            disabled={viewingHistory}
            items={[
              { value: '', label: '全部执行与未关联日志' },
              ...runIds.map(id => ({ value: id, label: `Run · ${id}` })),
            ]}
          >
            <SelectTrigger aria-label="执行范围" className="col-span-2 w-full sm:col-auto sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                { value: '', label: '全部执行与未关联日志' },
                ...runIds.map(id => ({ value: id, label: `Run · ${id}` })),
              ].map(item => (
                <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={events}
            onValueChange={(next, details) => { if (details.reason !== 'none' && next !== null) onEventsChange(next as LogEventFilter) }}
            items={[
              { value: 'key', label: '关键事件' },
              { value: 'all', label: '全部事件' },
            ]}
          >
            <SelectTrigger aria-label="事件范围" className="w-full sm:w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                { value: 'key', label: '关键事件' },
                { value: 'all', label: '全部事件' },
              ].map(item => (
                <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filter}
            onValueChange={(next, details) => { if (details.reason !== 'none' && next !== null) onFilterChange(next as LogFilter) }}
            items={[
              { value: 'all', label: '全部级别' },
              { value: 'ERROR', label: '错误' },
              { value: 'WARN', label: '警告' },
              { value: 'INFO', label: '信息' },
              { value: 'DEBUG', label: '调试' },
            ]}
          >
            <SelectTrigger aria-label="日志级别" className="w-full sm:w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                { value: 'all', label: '全部级别' },
                { value: 'ERROR', label: '错误' },
                { value: 'WARN', label: '警告' },
                { value: 'INFO', label: '信息' },
                { value: 'DEBUG', label: '调试' },
              ].map(item => (
                <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative col-span-2 sm:col-auto sm:min-w-56 sm:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tertiary" aria-hidden="true" />
            <Input
              value={search}
              autoComplete="off"
              onChange={event => onSearchChange(event.target.value)}
              placeholder="搜索日志内容"
              aria-label="搜索日志内容"
              className="w-full pl-9"
            />
          </div>
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
