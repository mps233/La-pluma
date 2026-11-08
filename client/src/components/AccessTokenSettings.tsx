import { useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { Button, Card, CardContent, CardHeader, Input } from './common'
import { isDesktopRuntime } from '@/desktop/bridge'
import {
  TOKEN_CHANGED_EVENT,
  clearAccessToken,
  readAccessToken,
  writeAccessToken,
} from '@/utils/accessToken'

export default function AccessTokenSettings() {
  const desktop = isDesktopRuntime()
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState(false)
  const [message, setMessage] = useState('')

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

  if (desktop) {
    return (
      <Card smoothCorners className="!p-0">
        <CardHeader title="访问令牌" />
        <CardContent>
          <p className="text-sm text-secondary">
            桌面端启动时自动注入访问令牌，无需手动设置。
          </p>
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