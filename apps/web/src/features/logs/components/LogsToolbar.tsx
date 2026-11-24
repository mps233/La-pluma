import { Download, Pause, Play, Search, Trash2, X } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/shared/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Switch } from '@/shared/ui/switch'
import type { LogEventFilter, LogFilter } from '../model/logModel'
import LogsUnavailableAction from './LogsUnavailableAction'

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
  canExport,
  onClear,
  onExport,
}: LogsToolbarProps) {
  const runOptions = viewingHistory
    ? [{ value: '', label: '历史文件不区分 Run' }]
    : [
        { value: '', label: '全部执行与未关联日志' },
        ...runIds.map(id => ({ value: id, label: `Run · ${id}` })),
      ]

  const autoScrollControl = (
    <div className="log-toggle-control flex min-h-11 min-w-0 items-center justify-between gap-3.5">
      <span className={`truncate text-xs font-medium text-muted-foreground ${viewingHistory ? 'opacity-50' : ''}`}>自动滚动</span>
      <Switch
        size="sm"
        checked={autoScroll}
        onCheckedChange={onAutoScrollChange}
        aria-label="自动滚动"
        disabled={viewingHistory}
      />
    </div>
  )

  const exportButton = (
    <Button
      onClick={onExport}
      size="sm"
      disabled={!canExport}
    >
      <Download className="h-4 w-4" aria-hidden="true" />
      导出筛选结果
    </Button>
  )

  return (
    <Card className="log-card log-toolbar-card gap-0 p-0!" data-region="toolbar">
      <CardContent className="log-toolbar">
        <div className="log-toolbar-controls">
          <Select
            value={viewingHistory ? '' : runId}
            onValueChange={(next, details) => { if (details.reason !== 'none' && next !== null) onRunIdChange(next) }}
            disabled={viewingHistory}
            items={runOptions}
          >
            <SelectTrigger aria-label="执行范围" className="col-span-2 w-full sm:col-auto sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {runOptions.map(item => (
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
            <SelectTrigger aria-label="事件范围" className="w-full sm:w-32">
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
            <SelectTrigger aria-label="日志级别" className="w-full sm:w-32">
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
          <InputGroup className="col-span-2 sm:col-auto sm:min-w-40 sm:flex-1">
            <InputGroupAddon align="inline-start">
              <Search className="h-4 w-4" aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              value={search}
              autoComplete="off"
              onChange={event => onSearchChange(event.target.value)}
              placeholder="搜索日志内容"
              aria-label="搜索日志内容"
            />
            {search && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  aria-label="清除搜索"
                  title="清除搜索"
                  onClick={() => onSearchChange('')}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
        </div>
        <div className="log-toolbar-footer">
          <div className="log-toolbar-toggles">
            {viewingHistory ? (
              <LogsUnavailableAction
                action="自动滚动"
                reason="历史文件不提供自动滚动"
                className="inline-flex min-w-0"
              >
                {autoScrollControl}
              </LogsUnavailableAction>
            ) : autoScrollControl}
            <div className="log-toggle-control flex min-h-11 min-w-0 items-center justify-between gap-3.5">
              <span className="truncate text-xs font-medium text-muted-foreground">折叠重复</span>
              <Switch
                size="sm"
                checked={collapseRepeats}
                onCheckedChange={onCollapseRepeatsChange}
                aria-label="折叠重复日志"
              />
            </div>
          </div>
          <div className="log-toolbar-actions">
            {!viewingHistory && (
              <Button
                onClick={onTogglePause}
                variant="outline"
                size="sm"
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
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                清屏
              </Button>
            )}
            {canExport ? exportButton : (
              <LogsUnavailableAction
                action="导出筛选结果"
                reason="当前筛选没有可导出的日志"
              >
                {exportButton}
              </LogsUnavailableAction>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
