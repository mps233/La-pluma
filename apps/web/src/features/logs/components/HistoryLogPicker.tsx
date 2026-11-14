// 历史模式下清理入口保持禁用：清理成功后的选择裁决可能绕过页面的“返回实时”，
// 在未恢复自动滚动前不开放该路径。

import { AlertCircle, ChevronRight, FileText, Trash2 } from 'lucide-react'
import { Button, Card, CardContent, CardHeader } from '@/shared/components'
import type { LogFile } from '../types'

interface HistoryLogPickerProps {
  readonly files: readonly LogFile[]
  readonly filesError: string | null
  readonly selectedFile: LogFile | null
  readonly cleanupDisabled: boolean
  readonly onSelect: (file: LogFile) => void
  readonly onCleanup: () => void
  readonly onReload: () => void
}

export default function HistoryLogPicker({
  files,
  filesError,
  selectedFile,
  cleanupDisabled,
  onSelect,
  onCleanup,
  onReload,
}: HistoryLogPickerProps) {
  return (
    <Card className="log-card log-history-card min-w-0 p-0!" smoothCorners>
      <CardHeader
        title="历史日志文件"
        actions={
          <div className="log-console-heading-actions">
            <span className="log-count hidden sm:inline-flex">{files.length} 个</span>
            <Button
              onClick={onCleanup}
              variant="outline"
              size="sm"
              icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
              disabled={cleanupDisabled}
            >
              清理旧日志
            </Button>
          </div>
        }
      />
      <CardContent className="log-history-content">
        {filesError && (
          <div className="log-history-state is-error flex-wrap px-4 py-6" role="alert">
            <AlertCircle className="h-5 w-5" aria-hidden="true" />
            <span>{filesError}</span>
            <Button type="button" variant="outline" size="sm" onClick={onReload}>
              重新加载
            </Button>
          </div>
        )}
        {!filesError && files.length === 0 && (
          <div className="log-history-state">
            <FileText className="h-5 w-5" aria-hidden="true" />
            <div>
              <p>暂无历史日志文件</p>
              <span>执行任务后会自动生成</span>
            </div>
          </div>
        )}
        {!filesError && files.length > 0 && (
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
                  <small>{new Date(file.modified).toLocaleString('zh-CN')} · {(file.size / 1024).toFixed(2)} KB</small>
                </span>
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
