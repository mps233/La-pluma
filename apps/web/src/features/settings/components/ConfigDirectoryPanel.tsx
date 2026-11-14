import { FolderOpen, RefreshCw } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/components'
import { useStatusStore } from '@/features/runtime-status'
import { useSettingsConfigDirectory } from '../hooks/useSettingsConfigDirectory'

export default function ConfigDirectoryPanel() {
  const setStatusMessage = useStatusStore(state => state.setMessage)
  const {
    path: configDir,
    status: configDirStatus,
    error: configDirError,
    reload: reloadConfigDir,
    open: openConfigDirectory,
  } = useSettingsConfigDirectory()

  const handleOpenConfigDir = async () => {
    const result = await openConfigDirectory()
    setStatusMessage(result.success ? '已打开配置目录' : `打开失败: ${result.message}`)
  }

  return (
    <Card smoothCorners className="config-directory-card p-0!">
      <CardContent>
        <div className="flex flex-wrap items-center justify-between gap-3.5">
          <div className="flex min-w-0 items-start gap-3.5">
            <span className="icon-well flex h-10 w-10 shrink-0 items-center justify-center rounded-lg brand-text">
              <FolderOpen size={20} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground">配置目录</h2>
              {configDirStatus === 'error' ? (
                <p className="mt-1 wrap-break-word text-sm text-danger wrap-anywhere" role="alert">{configDirError}</p>
              ) : (
                <p className="mt-1 wrap-break-word font-mono text-xs leading-5 text-muted-foreground wrap-anywhere" aria-live="polite">
                  {configDirStatus === 'loading' ? '正在读取目录...' : configDir}
                </p>
              )}
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {configDirStatus === 'error' && (
              <Button
                onClick={() => void reloadConfigDir()}
                variant="outline"
                size="sm"
                className="flex-1 sm:flex-none"
              >
                <RefreshCw size={16} aria-hidden="true" />
                重试
              </Button>
            )}
            <Button
              onClick={handleOpenConfigDir}
              variant="outline"
              size="sm"
              className="flex-1 sm:flex-none"
              disabled={configDirStatus !== 'ready' || !configDir}
            >
              <FolderOpen size={16} aria-hidden="true" />
              打开目录
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
