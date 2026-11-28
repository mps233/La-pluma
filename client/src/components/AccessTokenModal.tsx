import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { Button, Input } from './common'
import { Modal } from './common/Modal'
import { readAccessToken, writeAccessToken } from '@/utils/accessToken'

interface AccessTokenModalProps {
  isOpen: boolean
  onClose: () => void
}

/**
 * The access-token dialog, split from its listener so the modal and its
 * animation dependency load only after the API asks for a token.
 */
export default function AccessTokenModal({ isOpen, onClose }: AccessTokenModalProps) {
  const [value, setValue] = useState(readAccessToken)
  const [error, setError] = useState('')

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
    onClose()
    window.location.reload()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="需要访问令牌"
      size="sm"
      role="alertdialog"
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
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
