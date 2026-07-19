import { useState, useEffect, useRef } from 'react'
import { maaApi } from '../services/api'
import { motion } from 'framer-motion'
import Icons from './Icons'
import { PageHeader, Card, CardHeader, CardContent, Button, Input, Select, Checkbox } from './common'
import { useStatusStore } from '../store/statusStore'
import FloatingStatusIndicator from './FloatingStatusIndicator'
import type {
  MaaConnectionConfig,
  AutoUpdateConfig,
  ConfigSection,
  UpdateStatus
} from '@/types/components'

interface MaaVersionInfo {
  cli: string
  core: string
  raw: string
  resource?: {
    lastUpdated: string | null
    modifiedAt: string | null
    ageDays: number | null
    status: 'current' | 'stale' | 'unknown'
    message: string
  }
}

interface UpdateFeedback {
  type: 'success' | 'error'
  message: string
  resourceRetry?: boolean
}

interface DiscoveredDevice {
  address: string
  state: 'device' | 'offline' | 'unauthorized' | 'unknown' | 'candidate'
  details?: string
  adbPath?: string
  source: 'adb' | 'local-port' | 'emulator-adb'
}

interface DiscoveryResult {
  success: boolean
  message: string
  devices: DiscoveredDevice[]
  candidates: DiscoveredDevice[]
}

interface ConnectionFeedback {
  success: boolean
  message: string
}

export default function ConfigManager() {
  const { setMessage: setStatusMessage } = useStatusStore()
  const [configType, setConfigType] = useState<'connection' | 'resource' | 'instance'>(() => {
    const saved = localStorage.getItem('laPlumaConfigSection')
    return ['connection', 'resource', 'instance'].includes(saved || '')
      ? saved as 'connection' | 'resource' | 'instance'
      : 'connection'
  })
  const [configData, setConfigData] = useState<MaaConnectionConfig>({
    adb_path: '/opt/homebrew/bin/adb',
    address: '127.0.0.1:16384',
    config: 'CompatMac',
    auto_reconnect: true,
  })
  const [configDir, setConfigDir] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const [updating, setUpdating] = useState<UpdateStatus>({ core: false, cli: false })
  const [hotUpdating, setHotUpdating] = useState<boolean>(false)
  const [autoUpdate, setAutoUpdate] = useState<AutoUpdateConfig>({
    enabled: false,
    time: '04:00',
    updateCore: true,
    updateCli: true
  })
  const [versionInfo, setVersionInfo] = useState<MaaVersionInfo | null>(null)
  const [updateFeedback, setUpdateFeedback] = useState<UpdateFeedback | null>(null)
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredDevice[]>([])
  const [discoveryMessage, setDiscoveryMessage] = useState<string | null>(null)
  const [hasSearchedDevices, setHasSearchedDevices] = useState(false)
  const [discoveringDevices, setDiscoveringDevices] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionFeedback, setConnectionFeedback] = useState<ConnectionFeedback | null>(null)
  const didInitializeRef = useRef(false)

  useEffect(() => {
    if (didInitializeRef.current) return
    didInitializeRef.current = true

    void Promise.allSettled([
      loadConfigDir(),
      loadConfig(),
      loadAutoUpdateConfig(),
      loadVersion(),
    ])
  }, [])


  useEffect(() => {
    const handleSectionChange = (event: Event) => {
      const section = (event as CustomEvent).detail
      if (['connection', 'resource', 'instance'].includes(section)) {
        handleConfigTypeChange(section as 'connection' | 'resource' | 'instance')
      }
    }

    window.addEventListener('la-pluma-config-section', handleSectionChange)
    return () => window.removeEventListener('la-pluma-config-section', handleSectionChange)
  }, [])

  const loadVersion = async () => {
    try {
      const result = await maaApi.getVersion()
      if (result.success && result.data) {
        setVersionInfo(result.data)
      }
    } catch (error) {
      // 静默失败
    }
  }

  const loadAutoUpdateConfig = async () => {
    try {
      // 优先从服务器加载配置
      const serverConfig = await maaApi.loadUserConfig('auto-update')
      if (serverConfig.success && serverConfig.data) {
        setAutoUpdate(serverConfig.data)
        localStorage.setItem('autoUpdateConfig', JSON.stringify(serverConfig.data))
        
        // 同步到后端调度器
        if (serverConfig.data.enabled) {
          await maaApi.setupAutoUpdate(serverConfig.data)
        }
        return
      }
    } catch (error) {
      // 静默失败，从 localStorage 加载
    }
    
    // 服务器加载失败，从 localStorage 加载配置
    try {
      const saved = localStorage.getItem('autoUpdateConfig')
      if (saved) {
        const config: AutoUpdateConfig = JSON.parse(saved)
        setAutoUpdate(config)
        
        // 同步到后端
        if (config.enabled) {
          await maaApi.setupAutoUpdate(config)
        }
      }
    } catch (error) {
      // 静默失败，不影响用户体验
    }
  }

  const saveAutoUpdateConfig = async (config: AutoUpdateConfig) => {
    try {
      // 保存到 localStorage
      localStorage.setItem('autoUpdateConfig', JSON.stringify(config))
      
      // 保存到服务器
      await maaApi.saveUserConfig('auto-update', config)
      
      // 同步到后端调度器
      const result = await maaApi.setupAutoUpdate(config)

      if (result.success) {
        setStatusMessage(config.enabled ? `自动更新已启用，每天 ${config.time} 执行` : '自动更新已禁用')
      } else {
        setStatusMessage(`设置失败: ${result.message}`)
      }
    } catch (error) {
      setStatusMessage(`设置失败: ${(error as Error).message}`)
    }
  }

  const handleAutoUpdateChange = (field: keyof AutoUpdateConfig, value: boolean | string) => {
    const newConfig = { ...autoUpdate, [field]: value }
    setAutoUpdate(newConfig)
    saveAutoUpdateConfig(newConfig)
  }

  const loadConfigDir = async () => {
    try {
      const result = await maaApi.getConfigDir()
      if (result.success) {
        const nextConfigDir = typeof result.data === 'string'
          ? result.data
          : (result.data && typeof result.data === 'object' && 'path' in result.data && typeof (result.data as { path?: unknown }).path === 'string'
              ? (result.data as { path: string }).path
              : '')
        setConfigDir(nextConfigDir)
      }
    } catch (error) {
      // 静默失败，不影响用户体验
    }
  }

  const loadConfig = async () => {
    try {
      const result = await maaApi.getConfig()
      if (result.success && result.data) {
        setConfigData(result.data)
      }
    } catch (error) {
      // 静默失败，不影响用户体验
    }
  }

  const handleSave = async () => {
    setLoading(true)
    setStatusMessage('正在保存配置...')
    
    try {
      const result = await maaApi.saveConfig('default', { connection: configData })

      if (result.success) {
        setStatusMessage('配置保存成功')
      } else {
        setStatusMessage(`保存失败: ${maaApi.getErrorMessage(result)}`)
      }
    } catch (error) {
      setStatusMessage(`网络错误: ${(error as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setConfigData({
      adb_path: '/opt/homebrew/bin/adb',
      address: '127.0.0.1:16384',
      config: 'CompatMac',
      auto_reconnect: true,
    })
    setStatusMessage('已重置为默认值')
  }

  const handleDiscoverDevices = async () => {
    setDiscoveringDevices(true)
    setDiscoveryMessage(null)
    setConnectionFeedback(null)

    try {
      const result = await maaApi.discoverDevices(configData.adb_path)
      const discovery = result.data as DiscoveryResult | undefined
      const devices = discovery ? [...(discovery.devices || []), ...(discovery.candidates || [])] : []
      setDiscoveredDevices(devices)
      setDiscoveryMessage(discovery?.message || maaApi.getErrorMessage(result))
    } catch (error) {
      setDiscoveredDevices([])
      setDiscoveryMessage(`查找设备失败: ${(error as Error).message}`)
    } finally {
      setHasSearchedDevices(true)
      setDiscoveringDevices(false)
    }
  }

  const handleTestConnection = async (address = configData.address) => {
    setTestingConnection(true)
    setConnectionFeedback(null)

    try {
      const result = await maaApi.testConnection(configData.adb_path, address)
      const feedback = result.data as ConnectionFeedback | undefined
      setConnectionFeedback({
        success: Boolean(result.success && feedback?.success),
        message: feedback?.message || maaApi.getErrorMessage(result)
      })
    } catch (error) {
      setConnectionFeedback({ success: false, message: `连接测试失败: ${(error as Error).message}` })
    } finally {
      setTestingConnection(false)
    }
  }

  const handleUseDiscoveredDevice = async (device: DiscoveredDevice) => {
    const adbPath = device.adbPath || configData.adb_path
    setConfigData(current => ({ ...current, adb_path: adbPath, address: device.address }))
    setTestingConnection(true)
    setConnectionFeedback(null)

    try {
      const result = await maaApi.testConnection(adbPath, device.address)
      const feedback = result.data as ConnectionFeedback | undefined
      setConnectionFeedback({
        success: Boolean(result.success && feedback?.success),
        message: feedback?.message || maaApi.getErrorMessage(result)
      })
    } catch (error) {
      setConnectionFeedback({ success: false, message: `连接测试失败: ${(error as Error).message}` })
    } finally {
      setTestingConnection(false)
    }
  }

  const handleConfigTypeChange = (section: 'connection' | 'resource' | 'instance') => {
    localStorage.setItem('laPlumaConfigSection', section)
    setConfigType(section)
  }

  const handleOpenConfigDir = async () => {
    try {
      const result = await maaApi.openConfigDir()
      setStatusMessage(result.success ? '已打开配置目录' : `打开失败: ${maaApi.getErrorMessage(result)}`)
    } catch (error) {
      setStatusMessage(`打开失败: ${(error as Error).message}`)
    }
  }

  const handleUpdateCore = async () => {
    setUpdating(current => ({ ...current, core: true }))
    setUpdateFeedback(null)
    setStatusMessage('正在更新 MaaCore 并同步最新资源...')

    try {
      // 更新到当前渠道的最新版本
      // 不传版本号，后端会使用 maa update 命令
      const result = await maaApi.updateMaaCore()

      if (result.success) {
        const message = result.message || 'MaaCore 和资源已更新'
        setUpdateFeedback({ type: 'success', message })
        setStatusMessage(message)
        // 更新成功后重新加载版本信息
        await loadVersion()
      } else {
        const details = (result as any).error?.details || result.errorInfo?.details || {}
        const message = maaApi.getErrorMessage(result)
        setUpdateFeedback({
          type: 'error',
          message,
          resourceRetry: details.failedStep === 'resources' || details.coreUpdated === true
        })
        setStatusMessage(message, 'error')
      }
    } catch (error) {
      const message = `网络错误: ${(error as Error).message}`
      setUpdateFeedback({ type: 'error', message })
      setStatusMessage(message, 'error')
    } finally {
      setUpdating(current => ({ ...current, core: false }))
    }
  }

  const handleUpdateCli = async () => {
    setUpdating({ ...updating, cli: true })
    setStatusMessage('正在更新 MAA CLI...')

    try {
      const result = await maaApi.updateMaaCli()

      if (result.success) {
        setStatusMessage('MAA CLI 更新成功')
        // 更新成功后重新加载版本信息
        await loadVersion()
      } else {
        setStatusMessage(`更新失败: ${maaApi.getErrorMessage(result)}`)
      }
    } catch (error) {
      setStatusMessage(`网络错误: ${(error as Error).message}`)
    } finally {
      setUpdating({ ...updating, cli: false })
    }
  }

  const handleToggleCoreVersion = async () => {
    // 根据当前安装的版本判断目标渠道
    const currentIsBeta = versionInfo?.core.includes('beta') || versionInfo?.core.includes('alpha')
    const targetIsBeta = !currentIsBeta
    const targetChannel = targetIsBeta ? 'Beta' : '正式版'
    
    setUpdating(current => ({ ...current, core: true }))
    setUpdateFeedback(null)
    setStatusMessage(`正在切换到 ${targetChannel} 渠道...`)
    
    try {
      // 切换渠道并安装
      const versionToInstall = targetIsBeta ? 'beta' : 'stable'
      const result = await maaApi.updateMaaCore(versionToInstall)

      if (result.success) {
        const message = `已切换到 ${targetChannel} 渠道并同步最新资源`
        setUpdateFeedback({ type: 'success', message })
        setStatusMessage(message)
        // 更新成功后重新加载版本信息
        await loadVersion()
      } else {
        const details = (result as any).error?.details || result.errorInfo?.details || {}
        const message = maaApi.getErrorMessage(result)
        setUpdateFeedback({
          type: 'error',
          message,
          resourceRetry: details.failedStep === 'resources' || details.coreUpdated === true
        })
        setStatusMessage(message, 'error')
      }
    } catch (error) {
      const message = `网络错误: ${(error as Error).message}`
      setUpdateFeedback({ type: 'error', message })
      setStatusMessage(message, 'error')
    } finally {
      setUpdating(current => ({ ...current, core: false }))
    }
  }

  const handleHotUpdate = async () => {
    setHotUpdating(true)
    setUpdateFeedback(null)
    setStatusMessage('正在热更新资源文件...')

    try {
      const result = await maaApi.hotUpdateResources()

      if (result.success) {
        const message = result.message || '资源文件更新成功'
        setUpdateFeedback({ type: 'success', message })
        setStatusMessage(message)
        await loadVersion()
      } else {
        const message = maaApi.getErrorMessage(result)
        setUpdateFeedback({ type: 'error', message, resourceRetry: true })
        setStatusMessage(message, 'error')
      }
    } catch (error) {
      const message = `网络错误: ${(error as Error).message}`
      setUpdateFeedback({ type: 'error', message, resourceRetry: true })
      setStatusMessage(message, 'error')
    } finally {
      setHotUpdating(false)
    }
  }

  const configSections = [
    { id: 'connection', name: '连接配置', icon: <Icons.Monitor /> },
    { id: 'resource', name: '资源配置', icon: <Icons.Package /> },
    { id: 'instance', name: '实例选项', icon: <Icons.Lightning /> },
  ] satisfies ConfigSection[]

  return (
    <>
      <div className="app-page app-stack-section">
        <PageHeader
          icon={<Icons.CogIcon />}
          title="配置管理"
          subtitle="管理游戏连接、运行设置与资源更新"
          actions={<FloatingStatusIndicator />}
        />

        <Card animated delay={0.1}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="mb-2 text-lg font-bold text-primary">配置目录</h2>
              <p className="break-all font-mono text-sm text-secondary">{configDir || '加载中...'}</p>
            </div>
            <Button
              onClick={handleOpenConfigDir}
              variant="outline"
              size="sm"
            >
              打开目录
            </Button>
          </div>
        </Card>

        <Card animated delay={0.15}>
          <CardHeader title="更新管理" />
          <CardContent>
            {/* 自动更新设置 */}
            <div className="surface-soft app-info-card mb-6 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="mb-1 text-base font-semibold text-primary">自动更新</h3>
                  <p className="text-xs text-secondary">每天定时自动更新 MAA 组件</p>
                </div>
                <label className="relative inline-flex min-h-11 shrink-0 cursor-pointer items-center">
                  <input
                    type="checkbox"
                    checked={autoUpdate.enabled}
                    onChange={(e) => handleAutoUpdateChange('enabled', e.target.checked)}
                    aria-label="启用自动更新"
                    className="sr-only peer"
                  />
                  <div className="relative h-7 w-12 rounded-[var(--app-radius-pill)] border border-[var(--app-border-strong)] bg-[var(--app-surface-muted)] transition-colors after:absolute after:left-[3px] after:top-[3px] after:h-5 after:w-5 after:rounded-[var(--app-radius-pill)] after:border after:border-[var(--app-border)] after:bg-[var(--app-surface-solid)] after:shadow-sm after:transition-transform peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--app-accent)] peer-checked:border-[var(--app-accent)] peer-checked:bg-[var(--app-accent)] peer-checked:after:translate-x-5"></div>
                </label>
              </div>
              
              {autoUpdate.enabled && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* 左侧：定时更新设置 */}
                    <div className="space-y-4">
                      <div className="w-48">
                        <Input
                          type="text"
                          label="更新时间"
                          value={autoUpdate.time}
                          onChange={(value: string) => handleAutoUpdateChange('time', value)}
                          placeholder="HH:MM"
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <Checkbox
                          checked={autoUpdate.updateCore}
                          onChange={(checked: boolean) => handleAutoUpdateChange('updateCore', checked)}
                          label="更新 MaaCore"
                        />
                        <Checkbox
                          checked={autoUpdate.updateCli}
                          onChange={(checked: boolean) => handleAutoUpdateChange('updateCli', checked)}
                          label="更新 MAA CLI"
                        />
                      </div>
                    </div>
                    
                    {/* 右侧：资源热更新 */}
                    <div className="space-y-3">
                      <div>
                        <h4 className="mb-1 text-sm font-semibold text-primary">
                          资源热更新
                        </h4>
                        <p className="text-xs text-secondary">同步 MaaResource 仓库的最新资源文件（活动地图、公招数据等）</p>
                      </div>
                      <Button
                        onClick={handleHotUpdate}
                        disabled={hotUpdating || updating.core}
                        variant="primary"
                        fullWidth
                        icon={hotUpdating ? (
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        )}
                      >
                        {hotUpdating ? '更新中...' : '热更新资源'}
                      </Button>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
            
            {/* 手动更新按钮 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 更新 MaaCore */}
              <div className="surface-soft app-info-card p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-base font-semibold text-primary">
                        MaaCore
                      </h3>
                      {versionInfo && (
                        <span className="text-sm font-normal brand-text">
                          {versionInfo.core}
                        </span>
                      )}
                      {versionInfo && versionInfo.core.includes('beta') && (
                        <span className="status-warning rounded-[var(--app-radius-sm)] px-2 py-0.5 text-xs">
                          Beta
                        </span>
                      )}
                      {versionInfo && !versionInfo.core.includes('beta') && (
                        <span className="status-success rounded-[var(--app-radius-sm)] px-2 py-0.5 text-xs">
                          正式版
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-secondary">更新 MAA 核心组件和资源文件</p>
                    {versionInfo?.resource && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-xs text-tertiary">
                          资源更新：{versionInfo.resource.lastUpdated
                            ? new Date(versionInfo.resource.lastUpdated.replace(' ', 'T')).toLocaleString('zh-CN', { hour12: false })
                            : '未知'}
                        </span>
                        <span className={`rounded-[var(--app-radius-sm)] px-1.5 py-0.5 font-medium ${
                          versionInfo.resource.status === 'current'
                            ? 'status-success'
                            : 'status-warning'
                        }`}>
                          {versionInfo.resource.status === 'current' ? '资源正常' : '需要同步'}
                        </span>
                      </div>
                    )}
                    {versionInfo?.resource && versionInfo.resource.status !== 'current' && (
                      <p className="mt-1.5 text-xs leading-5 text-[var(--app-warning)]">
                        {versionInfo.resource.message}
                      </p>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button
                    onClick={handleUpdateCore}
                    disabled={updating.core || hotUpdating}
                    variant="primary"
                    className="w-full"
                    icon={updating.core ? (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    ) : <Icons.Download />}
                  >
                    {updating.core ? '同步中...' : '更新 MaaCore'}
                  </Button>
                  <button
                    type="button"
                    onClick={handleToggleCoreVersion}
                    disabled={updating.core || hotUpdating}
                    className="app-native-button app-native-button-primary w-full px-3 text-sm sm:w-auto"
                  >
                    {versionInfo?.core.includes('beta') || versionInfo?.core.includes('alpha') ? '切换到正式版' : '切换到 Beta'}
                  </button>
                  <Button
                    onClick={handleHotUpdate}
                    disabled={hotUpdating || updating.core}
                    variant="outline"
                    className="w-full sm:col-span-2"
                    icon={hotUpdating ? (
                      <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    ) : <Icons.RefreshCw />}
                  >
                    {hotUpdating ? '正在同步资源...' : '仅同步最新资源'}
                  </Button>
                </div>

                {updateFeedback && (
                  <div className={`mt-3 border-t border-[var(--app-border)] pt-3 text-xs leading-5 ${
                    updateFeedback.type === 'success'
                      ? 'text-[var(--app-success)]'
                      : 'text-[var(--app-warning)]'
                  }`}>
                    <p>{updateFeedback.message}</p>
                    {updateFeedback.resourceRetry && (
                      <button
                        type="button"
                        onClick={handleHotUpdate}
                        disabled={hotUpdating || updating.core}
                        className="app-native-button mt-1 !min-h-0 !border-0 !bg-transparent !px-0 !py-0 font-semibold underline underline-offset-2 shadow-none disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        重试资源同步
                      </button>
                    )}
                  </div>
                )}
                
              </div>

              {/* 更新 MAA CLI */}
              <div className="surface-soft app-info-card p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-base font-semibold text-primary">
                        MAA CLI
                      </h3>
                      {versionInfo && (
                        <span className="text-sm font-normal brand-text">
                          {versionInfo.cli}
                        </span>
                      )}
                      <span className="status-success rounded-[var(--app-radius-sm)] px-2 py-0.5 text-xs">
                        正式版
                      </span>
                    </div>
                    <p className="text-xs text-secondary">通过 Homebrew 更新 MAA 命令行工具</p>
                  </div>
                </div>
                <Button
                  onClick={handleUpdateCli}
                  disabled={updating.cli}
                  variant="primary"
                  fullWidth
                  icon={updating.cli ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : <Icons.Download />}
                >
                  {updating.cli ? '更新中...' : '更新 MAA CLI'}
                </Button>
                
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-[var(--app-space-section)] lg:grid-cols-[17rem_minmax(0,1fr)]">
          {/* 配置类型选择 */}
          <div>
            <motion.div 
              className="overflow-hidden rounded-[var(--app-radius-lg)] surface-panel"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
            >
              <div className="border-b border-[var(--app-border)] px-5 py-4">
                <h3 className="font-bold text-primary">配置类型</h3>
              </div>
              <div className="p-3">
                {configSections.map((section, index) => (
                  <motion.button
                    key={section.id}
                    onClick={() => handleConfigTypeChange(section.id)}
                    className={`
                      mb-2 flex min-h-12 w-full items-center space-x-3 rounded-xl px-4 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]
                      ${configType === section.id
                        ? 'brand-action-subtle'
                        : 'border border-transparent text-secondary hover:border-[var(--app-border)] hover:bg-[var(--app-surface-muted)] hover:text-primary'
                      }
                    `}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3 + index * 0.1 }}
                  >
                    <span className="flex h-8 w-8 items-center justify-center [&>*]:!h-8 [&>*]:!w-8">{section.icon}</span>
                    <span className="text-sm font-medium">{section.name}</span>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          </div>

          {/* 配置编辑器 */}
          <div className="min-w-0">
            <Card animated delay={0.2}>
              <CardHeader 
                title={configSections.find(s => s.id === configType)?.name || '配置'}
                actions={
                  <div className="flex items-center space-x-2">
                    <Button
                      onClick={handleReset}
                      disabled={loading}
                      variant="outline"
                      size="sm"
                      className="min-h-10"
                    >
                      重置
                    </Button>
                    <Button
                      onClick={handleSave}
                      disabled={loading}
                      variant="outline"
                      size="sm"
                      className="min-h-10 brand-chip"
                      icon={
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M17 16v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-7a2 2 0 012-2h2m3-4H5a2 2 0 00-2 2v7a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-1m-4 0V3m0 0L9 6m1.5-3L12 6" />
                        </svg>
                      }
                    >
                      {loading ? '保存中...' : '保存'}
                    </Button>
                  </div>
                }
              />
              <CardContent>
                {configType === 'connection' && (
                  <div className="space-y-5">
                    <Input
                      label="ADB 路径"
                      value={configData.adb_path}
                      onChange={(value: string) => setConfigData({ ...configData, adb_path: value })}
                      hint="ADB 可执行文件的路径"
                    />
                    <Input
                      label="连接地址"
                      value={configData.address}
                      onChange={(value: string) => {
                        setConfigData({ ...configData, address: value })
                        setConnectionFeedback(null)
                      }}
                      hint="模拟器连接地址，格式: IP:端口"
                    />
                    <section className="border-t border-[var(--app-border)] pt-4" aria-label="模拟器查找与连接测试">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-primary">模拟器查找</h3>
                          <p className="mt-1 text-xs text-tertiary">查找已连接设备和常见本机模拟器端口，选用后会填入连接地址。</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            loading={discoveringDevices}
                            loadingText="查找中..."
                            onClick={() => void handleDiscoverDevices()}
                          >
                            查找模拟器
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            loading={testingConnection}
                            loadingText="测试中..."
                            onClick={() => void handleTestConnection()}
                          >
                            测试连接
                          </Button>
                        </div>
                      </div>

                      {discoveryMessage && (
                        <p className="mt-3 text-xs text-secondary" role="status">{discoveryMessage}</p>
                      )}

                      {discoveredDevices.length > 0 && (
                        <div className="mt-3 divide-y divide-[var(--app-border)] overflow-hidden rounded-[var(--app-radius-md)] border border-[var(--app-border)]">
                          {discoveredDevices.map(device => {
                            const selectable = device.state === 'device' || device.state === 'candidate'
                            const stateLabel = device.state === 'device'
                              ? '已连接'
                              : device.state === 'candidate'
                                ? '可尝试连接'
                                : device.state === 'offline'
                                  ? '设备离线'
                                  : device.state === 'unauthorized'
                                    ? '等待授权'
                                    : '状态未知'
                            return (
                              <button
                                key={`${device.source}-${device.address}`}
                                type="button"
                                disabled={!selectable || testingConnection}
                                onClick={() => void handleUseDiscoveredDevice(device)}
                                className="app-native-button !flex !min-h-0 !w-full !justify-between !rounded-none !border-0 !bg-transparent !px-3 !py-2.5 !text-left !font-normal !shadow-none transition-colors hover:!bg-[var(--app-accent-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-medium text-primary">{device.address}</span>
                                  <span className="mt-0.5 block truncate text-xs text-tertiary">{device.details || (device.source === 'adb' ? 'ADB 已识别设备' : device.source === 'emulator-adb' ? '模拟器内置 ADB' : '本机端口')}</span>
                                </span>
                                <span className="shrink-0 text-xs text-secondary">{stateLabel}</span>
                              </button>
                            )
                          })}
                        </div>
                      )}

                      {hasSearchedDevices && !discoveredDevices.length && (
                        <p className="mt-3 text-xs text-tertiary">未找到已连接的设备。启动模拟器后重新查找，或手动填写连接地址。</p>
                      )}

                      {connectionFeedback && (
                        <div className={`mt-3 app-info-card text-xs ${connectionFeedback.success ? 'status-success' : 'status-danger'}`} role={connectionFeedback.success ? 'status' : 'alert'}>
                          {connectionFeedback.message}
                        </div>
                      )}
                    </section>
                    <Select
                      label="平台配置"
                      value={configData.config}
                      onChange={(value: string) => setConfigData({ ...configData, config: value })}
                      options={[
                        { value: 'CompatMac', label: 'CompatMac (macOS)' },
                        { value: 'CompatPOSIXShell', label: 'CompatPOSIXShell (Linux)' },
                        { value: 'General', label: 'General (Windows)' }
                      ]}
                      hint="平台相关配置"
                    />
                    <div className="surface-soft app-info-card px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-primary">自动重连</div>
                          <div className="mt-1 text-xs text-tertiary">maa-cli 0.7.3+ 支持。开启后游戏服务断开时自动重连；关闭则保持断开，适合手动排障。</div>
                        </div>
                        <Checkbox
                          label="启用"
                          checked={configData.auto_reconnect !== false}
                          onChange={(checked: boolean) => setConfigData({ ...configData, auto_reconnect: checked })}
                        />
                      </div>
                    </div>
                  </div>
                )}
                {configType === 'resource' && (
                  <div className="space-y-5">
                    <Select
                      label="全局资源"
                      value=""
                      onChange={() => {}}
                      options={[
                        { value: '', label: '简体中文 (默认)' },
                        { value: 'YoStarEN', label: 'YoStarEN (国际服)' },
                        { value: 'YoStarJP', label: 'YoStarJP (日服)' },
                        { value: 'YoStarKR', label: 'YoStarKR (韩服)' }
                      ]}
                    />
                    <Checkbox 
                      label="启用用户自定义资源" 
                      checked={false}
                      onChange={() => {}}
                    />
                  </div>
                )}
                {configType === 'instance' && (
                  <div className="space-y-5">
                    <Select
                      label="触摸模式"
                      value="ADB"
                      onChange={() => {}}
                      options={[
                        { value: 'ADB', label: 'ADB' },
                        { value: 'MiniTouch', label: 'MiniTouch' },
                        { value: 'MaaTouch', label: 'MaaTouch' }
                      ]}
                    />
                    <div className="space-y-3">
                      <Checkbox 
                        label="部署时暂停" 
                        checked={false}
                        onChange={() => {}}
                      />
                      <Checkbox 
                        label="启用 ADB Lite 模式" 
                        checked={false}
                        onChange={() => {}}
                      />
                      <Checkbox 
                        label="退出时关闭 ADB" 
                        checked={false}
                        onChange={() => {}}
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  )
}
