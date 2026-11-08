import { useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { Button, Input, Modal } from './common'
import { isDesktopRuntime } from '@/desktop/bridge'
import {
  AUTH_REQUIRED_EVENT,
  readAccessToken,
  writeAccessToken,
} from '@/utils/accessToken'

export default function AccessTokenGate() {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (isDesktopRuntime()) return undefined
    const handleAuthRequired = () => {
      setValue(readAccessToken())
      setError('')
      setOpen(true)
    }
    window.addEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired)
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired)
  }, [])

  if (isDesktopRuntime()) return null

  const save = () => {
    if (!value.trim()) {
      setError('请输入访问令牌')
      return
    }
    const token = writeAccessToken(value)
    if (!token) {
      setError('访问令牌格式无效')
      return
    }
    setOpen(false)
    window.location.reload()
  }

  return (
    <Modal
      isOpen={open}
      onClose={() => setOpen(false)}
      title="需要访问令牌"
      size="sm"
      role="alertdialog"
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            暂时关闭
          </Button>
          <Button onClick={save} icon={<KeyRound size={16} aria-hidden="true" />}>
            保存并重试
          </Button>
        </div>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm text-secondary">
          此服务要求访问令牌。输入管理员提供的令牌后，即可加载数据并连接实时预览。
        </p>
        <Input
          label="访问令牌"
          type="password"
          value={value}
          onChange={(next) => {
            setValue(next)
            setError('')
          }}
          placeholder="请输入访问令牌"
          hint="令牌只保存在本机浏览器。"
          error={error}
          autoFocus
          onKeyDown={(event) => {
            if (event.key === 'Enter') save()
          }}
        />
      </div>
    </Modal>
  )
}