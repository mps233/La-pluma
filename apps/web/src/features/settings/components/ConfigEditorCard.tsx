import type { ReactNode } from 'react'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import SettingsFeedback from './SettingsFeedback'

export interface ConfigEditorFeedback {
  readonly type: 'error'
  readonly message: string
  readonly retry: 'load' | 'save'
}

export interface ConfigEditorCardProps {
  readonly feedback: ConfigEditorFeedback | null
  /** 读取失败时提供的显式重试入口。 */
  readonly onRetryLoad?: () => void
  /** 自动保存失败后的显式重试入口。 */
  readonly onRetrySave?: () => void
  /** 设备忙时禁用错误重试，避免与执行租约冲突。 */
  readonly retryDisabled?: boolean
  /** 字段失焦时冲刷待保存草稿。 */
  readonly onFieldBlur?: () => void
  readonly children: ReactNode
}

/** 配置编辑卡的公共外壳：页内错误与字段冲刷入口；表单内容由各 section 提供。 */
export default function ConfigEditorCard({
  feedback,
  onRetryLoad,
  onRetrySave,
  retryDisabled = false,
  onFieldBlur,
  children,
}: ConfigEditorCardProps) {
  const retry = feedback?.retry === 'load' ? onRetryLoad : onRetrySave

  return (
    <Card>
      <CardContent className="app-stack-card" onBlur={onFieldBlur}>
        {feedback && (
          <SettingsFeedback
            tone="error"
            message={feedback.message}
            action={retry
              ? (
                  <Button
                    type="button"
                    onClick={retry}
                    disabled={retryDisabled}
                    variant="outline"
                    size="sm"
                  >
                    {feedback.retry === 'load' ? '重新读取' : '重试保存'}
                  </Button>
                )
              : undefined}
          />
        )}
        {children}
      </CardContent>
    </Card>
  )
}
