// 历史模式下清理入口保持禁用：清理成功后的选择裁决可能绕过页面的“返回实时”，
// 在未恢复自动滚动前不开放该路径。

import { AlertCircle, ChevronRight, FileText, LoaderCircle, RefreshCw, Trash2, X } from 'lucide-react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { ScrollArea } from '@/shared/ui/scroll-area'
import { SheetClose, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet'
import { EmptyState, Loading } from '@/shared/components'
import type { HistoryFilesPhase } from '../model/historyLogSession'
import { formatLogFileSize } from '../model/logFileSize'
import type { LogFile } from '../types'
import LogsUnavailableAction from './LogsUnavailableAction'

interface HistoryLogPickerProps {
  readonly files: readonly LogFile[]
  readonly filesPhase: HistoryFilesPhase
  readonly filesError: string | null
  readonly selectedFile: LogFile | null
  readonly cleanupDisabled: boolean
  readonly cleanupReason: string | null
  readonly onSelect: (file: LogFile) => void
  readonly onCleanup: () => void
  readonly onReload: () => void
}

export default function HistoryLogPicker({
  files,
  filesPhase,
  filesError,
  selectedFile,
  cleanupDisabled,
  cleanupReason,
  onSelect,
  onCleanup,
  onReload,
}: HistoryLogPickerProps) {
  const loading = filesPhase === 'loading' || filesPhase === 'idle'
  const cleanupButton = (
    <Button
      onClick={onCleanup}
      variant="outline"
      size="sm"
      disabled={cleanupDisabled}
    >
      <Trash2 className="h-4 w-4" aria-hidden="true" />
      清理旧日志
    </Button>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="flex-col items-start gap-3 border-b p-4 pr-12 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <SheetTitle>历史日志文件</SheetTitle>
          <SheetDescription className="sr-only">选择历史日志文件查看或清理旧日志</SheetDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="bg-primary-soft font-semibold tabular-nums text-primary-strong">
            {files.length} 个
          </Badge>
          <Button
            onClick={onReload}
            variant="ghost"
            size="icon-sm"
            disabled={filesPhase === 'loading'}
            aria-label="刷新历史日志列表"
            title="刷新历史日志列表"
            aria-busy={filesPhase === 'loading' || undefined}
          >
            {filesPhase === 'loading'
              ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
          </Button>
          {cleanupDisabled && cleanupReason ? (
            <LogsUnavailableAction action="清理旧日志" reason={cleanupReason}>
              {cleanupButton}
            </LogsUnavailableAction>
          ) : cleanupButton}
        </div>
        <SheetClose
          render={<Button variant="ghost" size="icon-sm" className="absolute top-3 right-3" aria-label="关闭历史日志" />}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </SheetClose>
      </SheetHeader>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-4">
          {filesError && (
            <Alert variant="destructive">
              <AlertCircle aria-hidden="true" />
              <AlertTitle>历史日志列表读取失败</AlertTitle>
              <AlertDescription>{filesError}</AlertDescription>
              <AlertAction>
                <Button type="button" variant="outline" size="sm" onClick={onReload}>
                  重新加载
                </Button>
              </AlertAction>
            </Alert>
          )}
          {loading && files.length === 0 && (
            <div className="log-history-state" aria-busy="true">
              <Loading text="正在读取历史日志..." />
            </div>
          )}
          {!loading && !filesError && files.length === 0 && (
            <EmptyState
              compact
              icon={<FileText className="h-5 w-5" aria-hidden="true" />}
              title="暂无历史日志文件"
              description="执行任务后会自动生成"
            />
          )}
          {files.length > 0 && (
            <div className="log-history-list">
              {files.map(file => (
                <button
                  type="button"
                  key={file.path}
                  onClick={() => onSelect(file)}
                  className={`log-history-row ${selectedFile?.path === file.path ? 'is-active' : ''}`}
                  aria-current={selectedFile?.path === file.path ? 'true' : undefined}
                >
                  <span className="log-history-icon"><FileText className="h-4 w-4" aria-hidden="true" /></span>
                  <span className="log-history-copy">
                    <strong title={file.name}>{file.name}</strong>
                    <small>{new Date(file.modified).toLocaleString('zh-CN')} · {formatLogFileSize(file.size)}</small>
                  </span>
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
