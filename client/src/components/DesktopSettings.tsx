import { useEffect, useState } from 'react'
import { Bell, FolderOpen, HardDrive, PlayCircle, ShieldCheck } from 'lucide-react'
import { Button, Card, CardContent, CardHeader, Switch } from './common'
import { desktopBridge, isDesktopRuntime, type DesktopAppInfo } from '@/desktop/bridge'

export default function DesktopSettings() {
  const [info, setInfo] = useState<DesktopAppInfo | null>(null)
  const [autostart, setAutostart] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<{ kind: 'adb' | 'maa'; path: string } | null>(null)

  useEffect(() => {
    if (!isDesktopRuntime()) return
    let cancelled = false
    void Promise.all([desktopBridge.appInfo(), desktopBridge.getAutostart()])
      .then(([appInfo, enabled]) => {
        if (cancelled) return
        setInfo(appInfo)
        setAutostart(enabled)
      })
      .catch(error => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : '桌面信息读取失败')
      })
    return () => { cancelled = true }
  }, [])

  if (!isDesktopRuntime()) return null

  const run = async (label: string, action: () => Promise<void>) => {
    if (busy) return
    setBusy(label)
    setMessage('')
    try {
      await action()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${label}失败`)
    } finally {
      setBusy(null)
    }
  }

  const choose = (kind: 'adb' | 'maa') => run(`选择 ${kind.toUpperCase()} 路径`, async () => {
    const path = await desktopBridge.chooseExecutable(kind)
    if (!path) return
    await desktopBridge.setExecutable(kind, path)
    setSelected({ kind, path })
    setMessage(`已保存并应用 ${kind.toUpperCase()} 路径`)
  })

  return (
    <Card smoothCorners>
      <CardHeader
        title="桌面"
        actions={<span className="status-success rounded-[var(--app-radius-pill)] px-2 py-1 text-xs">native shell</span>}
      />
      <CardContent className="space-y-4">
        <p className="text-sm text-secondary">
          托盘、原生文件选择、系统通知与开机自启由桌面外壳提供，Web/PWA 构建不显示这些选项。
        </p>

        {info && (
          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <div className="surface-soft rounded-[var(--app-radius-md)] px-3 py-2">
              <div className="text-xs text-tertiary">版本</div>
              <div className="text-primary">{info.version}</div>
            </div>
            <div className="surface-soft rounded-[var(--app-radius-md)] px-3 py-2">
              <div className="text-xs text-tertiary">平台</div>
              <div className="text-primary">{info.platform}</div>
            </div>
            <div className="surface-soft truncate rounded-[var(--app-radius-md)] px-3 py-2" title={info.userData}>
              <div className="text-xs text-tertiary">数据目录</div>
              <div className="truncate text-primary">{info.userData}</div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => run('打开数据目录', async () => { await desktopBridge.openDataDir() })}
            disabled={busy !== null}
            icon={<FolderOpen size={16} aria-hidden="true" />}
          >
            打开数据目录
          </Button>
          <Button
            variant="outline"
            onClick={() => run('打开日志目录', async () => { await desktopBridge.openLogs() })}
            disabled={busy !== null}
            icon={<HardDrive size={16} aria-hidden="true" />}
          >
            打开日志目录
          </Button>
          <Button
            variant="outline"
            onClick={() => choose('adb')}
            disabled={busy !== null}
            icon={<PlayCircle size={16} aria-hidden="true" />}
          >
            选择 ADB
          </Button>
          <Button
            variant="outline"
            onClick={() => choose('maa')}
            disabled={busy !== null}
            icon={<ShieldCheck size={16} aria-hidden="true" />}
          >
            选择 MAA CLI
          </Button>
          <Button
            variant="ghost"
            onClick={() => run('测试通知', async () => {
              await desktopBridge.notify('La Pluma', '桌面通知已启用')
              setMessage('已发送桌面通知')
            })}
            disabled={busy !== null}
            icon={<Bell size={16} aria-hidden="true" />}
          >
            测试通知
          </Button>
        </div>

        {selected && (
          <div className="surface-soft flex flex-wrap items-center gap-2 rounded-[var(--app-radius-md)] px-3 py-2 text-xs">
            <span className="text-tertiary">{selected.kind.toUpperCase()}</span>
            <code className="min-w-0 flex-1 truncate text-primary">{selected.path}</code>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(selected.path)
                  .then(() => setMessage('路径已复制'))
                  .catch(() => setMessage('剪贴板不可用，请手动选择路径'))
              }}
            >
              复制
            </Button>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-[var(--app-border-subtle)] pt-3">
          <div>
            <div className="text-sm text-primary">登录时启动 La Pluma</div>
            <div className="text-xs text-tertiary">在系统登录后自动保持托盘与调度服务运行</div>
          </div>
          <Switch
            checked={autostart}
            label="登录时启动 La Pluma"
            onChange={(checked) => run('设置开机自启', async () => {
              await desktopBridge.setAutostart(checked)
              setAutostart(checked)
              setMessage(checked ? '已开启登录启动' : '已关闭登录启动')
            })}
            disabled={busy !== null}
          />
        </div>

        {message && <p className="text-xs text-secondary" role="status">{message}</p>}
      </CardContent>
    </Card>
  )
}