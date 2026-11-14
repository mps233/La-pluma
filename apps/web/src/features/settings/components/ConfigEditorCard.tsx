import type { ReactNode } from 'react'
import { RotateCcw, Save } from 'lucide-react'
import { Button, Card, CardContent, CardHeader } from '@/shared/components'

export interface SettingsFeedback {
  type: 'success' | 'error' | 'warning'
  message: string
}

export interface ConfigEditorCardProps {
  readonly title: string
  readonly feedback: SettingsFeedback | null
  readonly saving: boolean
  readonly saveDisabled?: boolean
  readonly saveBlockedReason?: string | null
  /** 首次服务端快照被采纳前禁用编辑入口（重置），保存另有 saveDisabled。 */
  readonly editingDisabled?: boolean
  /** 读取失败时提供的显式重试入口。 */
  readonly onRetryLoad?: () => void
  readonly onSave: () => void
  readonly onReset: () => void
  readonly children: ReactNode
}

/** 配置编辑卡的公共外壳：标题、保存/重置按钮与页内反馈；表单内容由各 section 提供。 */
export default function ConfigEditorCard({
  title,
  feedback,
  saving,
  saveDisabled = false,
  saveBlockedReason = null,
  editingDisabled = false,
  onRetryLoad,
  onSave,
  onReset,
  children,
}: ConfigEditorCardProps) {
  const feedbackExplainsFailure = feedback?.type === 'error'
  const blockedReason = saveBlockedReason && !feedbackExplainsFailure
    && saveBlockedReason !== feedback?.message
    ? saveBlockedReason
    : null

  return (
    <Card smoothCorners className="config-editor-card p-0!">
      <CardHeader
        title={title}
        actions={(
          <div className="flex items-center gap-2">
            <Button
              onClick={onReset}
              disabled={saving || editingDisabled}
              variant="outline"
              size="sm"
              icon={<RotateCcw size={16} aria-hidden="true" />}
            >
              重置
            </Button>
            <Button
              onClick={onSave}
              loading={saving}
              disabled={saveDisabled}
              loadingText="保存中"
              variant="primary"
              size="sm"
              icon={<Save size={16} aria-hidden="true" />}
            >
              保存
            </Button>
          </div>
        )}
      />
      <CardContent>
        <div className="app-stack-card">
          {blockedReason && (
            <div
              className="rounded-lg px-3 py-2.5 text-xs leading-5 status-warning"
              role="status"
            >
              {blockedReason}
            </div>
          )}
          {feedback && (
            <div
              className={`rounded-lg px-3 py-2.5 text-xs leading-5 ${
                feedback.type === 'success'
                  ? 'status-success'
                  : feedback.type === 'warning'
                    ? 'status-warning'
                    : 'status-danger'
              }`}
              role={feedback.type === 'error' ? 'alert' : 'status'}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0">{feedback.message}</p>
                {onRetryLoad && (
                  <Button
                    type="button"
                    onClick={onRetryLoad}
                    disabled={saving}
                    variant="outline"
                    size="sm"
                  >
                    重新读取
                  </Button>
                )}
              </div>
            </div>
          )}
          {children}
        </div>
      </CardContent>
    </Card>
  )
}
