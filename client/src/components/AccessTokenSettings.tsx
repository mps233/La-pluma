import { useEffect, useState } from 'react'
import { Copy, KeyRound } from 'lucide-react'
import { Button, Card, CardContent, CardHeader, Input } from './common'
import { desktopBridge, isDesktopRuntime } from '@/desktop/bridge'
import {
  TOKEN_CHANGED_EVENT,
  clearAccessToken,
  readAccessToken,
  writeAccessToken,
} from '@/utils/accessToken'

const DESKTOP_TOKEN_PATTERN = /^[!-~]{8,128}$/

export default function AccessTokenSettings() {
  const desktop = isDesktopRuntime()
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState(false)
  const [message, setMessage] = useState('')
  const [desktopSource, setDesktopSource] = useState<'env' | 'settings' | null>(null)
  const [desktopLoading, setDesktopLoading] = useState(desktop)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const sync = () => {
      const token = readAccessToken()
      setValue(token)
      setSaved(Boolean(token))
    }
    sync()
    window.addEventListener(TOKEN_CHANGED_EVENT, sync)
    return () => window.removeEventListener(TOKEN_CHANGED_EVENT, sync)
  }, [])

  useEffect(() => {
    if (!desktop) return
    let cancelled = false
    desktopBridge.getAccessToken()
      .then((info) => {
        if (cancelled) return
        setValue(info.token)
        setSaved(Boolean(info.token))
        setDesktopSource(info.source)
        setDesktopLoading(false)
      })
      .catch((error) => {
        if (cancelled) return
        setMessage(error instanceof Error ? error.message : '读取访问令牌失败')
        setDesktopLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [desktop])

  const desktopLocked = desktopSource === 'env'

  const saveDesktopToken = async () => {
    const token = value.trim().replace(/^Bearer\s+/i, '').trim()
    if (!DESKTOP_TOKEN_PATTERN.test(token)) {
      setMessage('访问令牌需要 8–128 个可见 ASCII 字符，且不能包含空格')
      return
    }
    setSaving(true)
    setMessage('')
    try {
      const savedToken = await desktopBridge.setAccessToken(token)
      writeAccessToken(savedToken)
      setValue(savedToken)
      setSaved(true)
      setMessage('令牌已更新，当前页面已切换；手机或其他浏览器请重新输入新令牌。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存访问令牌失败')
    } finally {
      setSaving(false)
    }
  }

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setMessage('令牌已复制')
    } catch {
      setMessage('复制失败，请手动选择输入框内容')
    }
  }

  if (desktop) {
    return (
      <Card smoothCorners className="!p-0">
        <CardHeader
          title="访问令牌"
          actions={(
            <span className={`rounded-[var(--app-radius-pill)] px-2 py-1 text-xs ${saved ? 'status-success' : 'text-tertiary'}`}>
              {desktopLoading ? '读取中' : desktopLocked ? '环境变量' : saved ? '已设置' : '未设置'}
            </span>
          )}
        />
        <CardContent className="space-y-4">
          <p className="text-sm text-secondary">
            桌面端和服务端共用此令牌。修改后当前窗口会自动切换，手机 PWA 或其他浏览器需要使用新令牌。
          </p>
          {desktopLocked && (
            <p className="text-sm text-secondary">
              访问令牌由环境变量 LA_PLUMA_TOKEN 设置，应用内修改不会生效。
            </p>
          )}
          <Input
            label="访问令牌"
            type="password"
            value={value}
            onChange={(next) => {
              setValue(next)
              setMessage('')
            }}
            placeholder="8–128 个可见 ASCII 字符"
            hint="只能使用可见 ASCII 字符，不能包含空格。保存后立即生效。"
            disabled={desktopLoading || desktopLocked}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void saveDesktopToken()}
              disabled={desktopLoading || desktopLocked || saving || !value.trim()}
              loading={saving}
              loadingText="保存中"
              icon={<KeyRound size={16} aria-hidden="true" />}
            >
              保存令牌
            </Button>
            <Button
              variant="ghost"
              onClick={() => void copyToken()}
              disabled={!value}
              icon={<Copy size={16} aria-hidden="true" />}
            >
              复制令牌
            </Button>
          </div>
          {message && <p className="text-xs text-secondary" role="status">{message}</p>}
        </CardContent>
      </Card>
    )
  }

  const save = () => {
    if (!value.trim()) {
      setMessage('请输入访问令牌')
      return
    }
    const token = writeAccessToken(value)
    if (!token) {
      setMessage('访问令牌格式无效')
      return
    }
    setSaved(true)
    setMessage('令牌已保存，新的请求会自动使用该令牌。')
  }

  const clear = () => {
    clearAccessToken()
    setValue('')
    setSaved(false)
    setMessage('令牌已清除。需要时请重新输入。')
  }

  return (
    <Card smoothCorners className="!p-0">
      <CardHeader
        title="访问令牌"
        actions={(
          <span className={`rounded-[var(--app-radius-pill)] px-2 py-1 text-xs ${saved ? 'status-success' : 'text-tertiary'}`}>
            {saved ? '已设置' : '未设置'}
          </span>
        )}
      />
      <CardContent className="space-y-4">
        <p className="text-sm text-secondary">
          手机 PWA 或远程访问要求令牌时，在这里输入一次即可。令牌只保存在当前浏览器。
        </p>
        <Input
          label="访问令牌"
          type="password"
          value={value}
          onChange={(next) => {
            setValue(next)
            setMessage('')
          }}
          placeholder="请输入访问令牌"
          hint="保存后令牌会用于 API 与实时预览连接。"
        />
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={save}
            disabled={!value.trim()}
            icon={<KeyRound size={16} aria-hidden="true" />}
          >
            保存令牌
          </Button>
          <Button variant="ghost" onClick={clear} disabled={!saved && !value}>
            清除令牌
          </Button>
        </div>
        {message && <p className="text-xs text-secondary" role="status">{message}</p>}
      </CardContent>
    </Card>
  )
}
