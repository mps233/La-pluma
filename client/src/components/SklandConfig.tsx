import { useState, useEffect } from 'react'
import { sklandSendCode, sklandLogin, sklandLogout, getSklandStatus } from '../services/api'
import Icons from './Icons'
import { Card, Button, Input } from './common'

export default function SklandConfig() {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [savePassword, setSavePassword] = useState(false) // 记住密码选项
  const [loginMethod, setLoginMethod] = useState<'code' | 'password'>('password') // 默认密码登录
  const [countdown, setCountdown] = useState(0)
  const [status, setStatus] = useState<{ isLoggedIn: boolean; phone: string | null; loginTime: number | null }>({
    isLoggedIn: false,
    phone: null,
    loginTime: null
  })
  const [loading, setLoading] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    loadStatus()
  }, [])

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [countdown])

  const loadStatus = async () => {
    try {
      const result = await getSklandStatus()
      if (result.success && result.data) {
        setStatus(result.data)
      }
    } catch (error) {
      console.error('加载森空岛状态失败:', error)
    }
  }

  const handleSendCode = async () => {
    if (!phone) {
      setMessage({ type: 'error', text: '请输入手机号' })
      return
    }

    setSendingCode(true)
    setMessage(null)

    try {
      const result = await sklandSendCode(phone)
      if (result.success) {
        setMessage({ type: 'success', text: '验证码已发送！' })
        setCountdown(60)
      } else {
        setMessage({ type: 'error', text: result.message || '发送失败' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '发送失败' })
    } finally {
      setSendingCode(false)
    }
  }

  const handleLogin = async () => {
    if (!phone) {
      setMessage({ type: 'error', text: '请输入手机号' })
      return
    }

    if (loginMethod === 'code' && !code) {
      setMessage({ type: 'error', text: '请输入验证码' })
      return
    }

    if (loginMethod === 'password' && !password) {
      setMessage({ type: 'error', text: '请输入密码' })
      return
    }

    setLoading(true)
    setMessage(null)

    try {
      const credential = loginMethod === 'code' ? code : password
      // 只有密码登录时才传递 savePassword 参数
      const shouldSavePassword = loginMethod === 'password' && savePassword
      const result = await sklandLogin(phone, credential, shouldSavePassword)
      if (result.success) {
        setMessage({ type: 'success', text: shouldSavePassword ? '登录成功！已保存登录凭据，支持自动重登' : '登录成功！' })
        setCode('')
        setPassword('')
        await loadStatus()
      } else {
        setMessage({ type: 'error', text: result.message || '登录失败' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '登录失败' })
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    if (!confirm('确定要登出吗？')) return

    setLoading(true)
    setMessage(null)

    try {
      const result = await sklandLogout()
      if (result.success) {
        setMessage({ type: 'success', text: '已登出' })
        setPhone('')
        setCode('')
        await loadStatus()
      } else {
        setMessage({ type: 'error', text: result.message || '登出失败' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '登出失败' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex items-start justify-between mb-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              森空岛账号
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              登录后可在控制台查看实时理智、干员数据等信息
            </p>
          </div>
          <Icons.Users />
        </div>

        {status.isLoggedIn ? (
          <div className="space-y-4">
            <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Icons.CheckCircle />
                    <span className="font-semibold text-green-700 dark:text-green-400">
                      已登录
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    账号: {status.phone}
                  </p>
                  {status.loginTime && (
                    <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                      登录时间: {new Date(status.loginTime).toLocaleString('zh-CN')}
                    </p>
                  )}
                </div>
                <Button
                  onClick={handleLogout}
                  variant="outline"
                  size="sm"
                  disabled={loading}
                >
                  {loading ? '处理中...' : '登出'}
                </Button>
              </div>
            </div>

            <div className="p-4 surface-soft rounded-lg">
              <div className="flex items-start gap-3">
                <Icons.Lightning />
                <div className="text-sm text-gray-700 dark:text-gray-300">
                  <p className="font-semibold mb-1">功能说明</p>
                  <ul className="list-disc list-inside space-y-1 text-gray-600 dark:text-gray-400">
                    <li>控制台显示实时理智和恢复时间</li>
                    <li>查看干员统计（精二、满级等）</li>
                    <li>查看任务进度（每日、每周、剿灭）</li>
                    <li>查看公招状态和剩余时间</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* 登录方式切换 */}
            <div className="flex gap-2 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
              <button
                onClick={() => setLoginMethod('password')}
                className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  loginMethod === 'password'
                    ? 'bg-white dark:bg-gray-700 brand-text shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                密码登录
              </button>
              <button
                onClick={() => setLoginMethod('code')}
                className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  loginMethod === 'code'
                    ? 'bg-white dark:bg-gray-700 brand-text shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                验证码登录
              </button>
            </div>

            <Input
              label="手机号"
              type="text"
              value={phone}
              onChange={(value: string) => setPhone(value)}
              placeholder="请输入手机号"
              disabled={loading || sendingCode}
            />

            {loginMethod === 'password' ? (
              <>
                <Input
                  label="密码"
                  type="password"
                  value={password}
                  onChange={(value: string) => setPassword(value)}
                  placeholder="请输入密码"
                  disabled={loading}
                />
                
                {/* 记住密码选项 */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={savePassword}
                    onChange={(e) => setSavePassword(e.target.checked)}
                    className="custom-checkbox"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    记住密码（启用自动重登）
                  </span>
                </label>
              </>
            ) : (
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input
                    label="验证码"
                    type="text"
                    value={code}
                    onChange={(value: string) => setCode(value)}
                    placeholder="请输入验证码"
                    disabled={loading}
                  />
                </div>
                <div className="pt-6">
                  <Button
                    onClick={handleSendCode}
                    variant="outline"
                    disabled={sendingCode || countdown > 0 || !phone}
                    className="whitespace-nowrap"
                  >
                    {countdown > 0 ? `${countdown}秒` : sendingCode ? '发送中...' : '发送验证码'}
                  </Button>
                </div>
              </div>
            )}

            <Button
              onClick={handleLogin}
              variant="gradient"
              fullWidth
              disabled={loading}
            >
              {loading ? '登录中...' : '登录'}
            </Button>

            <div className="p-4 status-warning rounded-lg">
              <div className="flex items-start gap-3">
                <Icons.Lightning />
                <div className="text-sm text-gray-700 dark:text-gray-300">
                  <p className="font-semibold mb-1">安全提示</p>
                  <ul className="list-disc list-inside space-y-1 text-gray-600 dark:text-gray-400">
                    <li>支持密码登录和验证码登录两种方式</li>
                    <li>密码登录更稳定，推荐使用</li>
                    <li>勾选"记住密码"后，Token 过期时会自动重新登录</li>
                    <li>密码使用 AES-256 加密存储，相对安全</li>
                    <li>令牌存储在服务器，请妥善保管</li>
                    <li>数据每5分钟自动刷新一次</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {message && (
          <div className={`mt-4 p-4 rounded-lg ${
            message.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
          }`}>
            <div className="flex items-center gap-2">
              {message.type === 'success' ? (
                <Icons.CheckCircle />
              ) : (
                <Icons.Stop />
              )}
              <span className={`text-sm font-medium ${
                message.type === 'success'
                  ? 'text-green-700 dark:text-green-400'
                  : 'text-red-700 dark:text-red-400'
              }`}>
                {message.text}
              </span>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              关于森空岛
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              森空岛是鹰角网络官方的游戏社区平台
            </p>
          </div>
          <Icons.Lightning />
        </div>

        <div className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
          <p>
            通过森空岛 API，可以获取游戏内的实时数据，包括：
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>理智数量和恢复时间</li>
            <li>干员列表和培养进度</li>
            <li>基建状态和产出</li>
            <li>公开招募进度</li>
            <li>任务完成情况</li>
            <li>剿灭作战进度</li>
          </ul>
          <p className="pt-2">
            数据每5分钟自动刷新一次，也可以在控制台手动刷新。
          </p>
        </div>
      </Card>
    </div>
  )
}
