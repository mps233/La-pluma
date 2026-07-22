import { useState, useEffect, useRef, useCallback } from 'react'
import { maaApi } from '../services/api'
import { motion } from 'framer-motion'
import Icons from './Icons'
import { PageHeader, Card, CardHeader, CardContent, Button, Input, Select, Checkbox, SmoothPanel } from './common'
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

interface SettingsFeedback {
  type: 'success' | 'error' | 'warning'
  message: string
}

const DEFAULT_AUTO_UPDATE_CONFIG: AutoUpdateConfig = {
  enabled: false,
  time: '04:00',
  updateCore: true,
  updateCli: true
}

const normalizeAutoUpdateConfig = (value: unknown): AutoUpdateConfig | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const config = value as Partial<AutoUpdateConfig>
  return {
    enabled: typeof config.enabled === 'boolean' ? config.enabled : DEFAULT_AUTO_UPDATE_CONFIG.enabled,
    time: typeof config.time === 'string' ? config.time : DEFAULT_AUTO_UPDATE_CONFIG.time,
    updateCore: typeof config.updateCore === 'boolean' ? config.updateCore : DEFAULT_AUTO_UPDATE_CONFIG.updateCore,
    updateCli: typeof config.updateCli === 'boolean' ? config.updateCli : DEFAULT_AUTO_UPDATE_CONFIG.updateCli,
  }
}

const isValidUpdateTime = (value: string) => {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return false
  return Number(match[1]) <= 23 && Number(match[2]) <= 59
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
  const [configDirStatus, setConfigDirStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [configDirError, setConfigDirError] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [updating, setUpdating] = useState<UpdateStatus>({ core: false, cli: false })
  const [hotUpdating, setHotUpdating] = useState<boolean>(false)
  const [autoUpdate, setAutoUpdate] = useState<AutoUpdateConfig>(DEFAULT_AUTO_UPDATE_CONFIG)
  const [autoUpdateDirty, setAutoUpdateDirty] = useState(false)
  const [autoUpdateSaving, setAutoUpdateSaving] = useState(false)
  const [autoUpdateFeedback, setAutoUpdateFeedback] = useState<SettingsFeedback | null>(null)
  const [configFeedback, setConfigFeedback] = useState<SettingsFeedback | null>(null)
  const [versionInfo, setVersionInfo] = useState<MaaVersionInfo | null>(null)
  const [updateFeedback, setUpdateFeedback] = useState<UpdateFeedback | null>(null)
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredDevice[]>([])
  const [discoveryMessage, setDiscoveryMessage] = useState<string | null>(null)
  const [hasSearchedDevices, setHasSearchedDevices] = useState(false)
  const [discoveringDevices, setDiscoveringDevices] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionFeedback, setConnectionFeedback] = useState<ConnectionFeedback | null>(null)
  const didInitializeRef = useRef(false)
  const autoUpdateTouchedRef = useRef(false)
  const autoUpdateRevisionRef = useRef(0)
  const autoUpdateSaveInFlightRef = useRef(false)
  const connectionRevisionRef = useRef(0)
  const connectionSaveInFlightRef = useRef(false)
  const updateInFlightRef = useRef(false)

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

  const loadVersion = useCallback(async () => {
    try {
      const result = await maaApi.getVersion()
      if (result.success && result.data) {
        setVersionInfo(result.data)
      }
    } catch (error) {
      // 静默失败
    }
  }, [])

  const loadAutoUpdateConfig = useCallback(async () => {
    let serverError: string | null = null

    try {
      const serverConfig = await maaApi.loadUserConfig('auto-update')
      const normalizedConfig = normalizeAutoUpdateConfig(serverConfig.data)
      if (serverConfig.success && normalizedConfig) {
        if (!autoUpdateTouchedRef.current) {
          setAutoUpdate(normalizedConfig)
          setAutoUpdateDirty(false)
          localStorage.setItem('autoUpdateConfig', JSON.stringify(normalizedConfig))
        }
        return
      }

      if (!serverConfig.success) {
        serverError = `自动更新设置读取失败: ${maaApi.getErrorMessage(serverConfig)}`
      }
    } catch (error) {
      serverError = `自动更新设置读取失败: ${(error as Error).message}`
    }

    try {
      const saved = localStorage.getItem('autoUpdateConfig')
      if (saved) {
        const config = normalizeAutoUpdateConfig(JSON.parse(saved))
        if (config && !autoUpdateTouchedRef.current) {
          setAutoUpdate(config)
          setAutoUpdateDirty(true)
        }

        if (config) {
          const message = serverError
            ? `${serverError}，已显示此设备上次保存的设置，请保存后重试`
            : '已载入此设备上次保存的自动更新设置，请保存后应用'
          setAutoUpdateFeedback({ type: 'warning', message })
          setStatusMessage(message, 'warning')
          return
        }
      }
    } catch (error) {
      const message = `自动更新设置读取失败: ${(error as Error).message}`
      setAutoUpdateFeedback({ type: 'error', message })
      setStatusMessage(message, 'error')
      return
    }

    if (serverError) {
      setAutoUpdateFeedback({ type: 'error', message: serverError })
      setStatusMessage(serverError, 'error')
    }
  }, [setStatusMessage])

  const saveAutoUpdateConfig = async (config: AutoUpdateConfig) => {
    if (autoUpdateSaveInFlightRef.current) return
    if (config.enabled && !isValidUpdateTime(config.time)) {
      const message = '更新时间格式无效，请输入 00:00 到 23:59 之间的时间'
      setAutoUpdateFeedback({ type: 'error', message })
      setStatusMessage(message, 'error')
      return
    }

    const savedRevision = autoUpdateRevisionRef.current
    autoUpdateSaveInFlightRef.current = true
    setAutoUpdateSaving(true)
    setAutoUpdateFeedback(null)
    setStatusMessage('正在保存自动更新设置...', 'info')

    try {
      const saveResult = await maaApi.saveUserConfig('auto-update', config)
      if (!saveResult.success) {
        const message = `自动更新设置保存失败: ${maaApi.getErrorMessage(saveResult)}`
        setAutoUpdateFeedback({ type: 'error', message })
        setStatusMessage(message, 'error')
        return
      }

      const result = await maaApi.setupAutoUpdate(config)
      const schedulerResult = result.data && typeof result.data === 'object' && !Array.isArray(result.data)
        ? result.data as { success?: boolean; message?: string }
        : null
      const schedulerSucceeded = result.success && (!config.enabled || schedulerResult?.success !== false)

      if (schedulerSucceeded) {
        if (savedRevision === autoUpdateRevisionRef.current) {
          const message = config.enabled ? `自动更新已启用，每天 ${config.time} 执行` : '自动更新已禁用'
          localStorage.setItem('autoUpdateConfig', JSON.stringify(config))
          setAutoUpdateDirty(false)
          setAutoUpdateFeedback({ type: 'success', message })
          setStatusMessage(message, 'success')
        } else {
          const message = '此前设置已保存，当前更改尚未保存'
          setAutoUpdateFeedback({ type: 'warning', message })
          setStatusMessage(message, 'warning')
        }
      } else {
        const message = `自动更新设置应用失败: ${schedulerResult?.message || maaApi.getErrorMessage(result)}`
        setAutoUpdateFeedback({ type: 'error', message })
        setStatusMessage(message, 'error')
      }
    } catch (error) {
      const message = `自动更新设置保存失败: ${(error as Error).message}`
      setAutoUpdateFeedback({ type: 'error', message })
      setStatusMessage(message, 'error')
    } finally {
      autoUpdateSaveInFlightRef.current = false
      setAutoUpdateSaving(false)
    }
  }

  const handleAutoUpdateChange = (field: keyof AutoUpdateConfig, value: boolean | string) => {
    autoUpdateTouchedRef.current = true
    autoUpdateRevisionRef.current += 1
    setAutoUpdate(current => {
      const next = { ...current, [field]: value }
      localStorage.setItem('autoUpdateConfig', JSON.stringify(next))
      return next
    })
    setAutoUpdateDirty(true)
    setAutoUpdateFeedback(null)
  }

  const loadConfigDir = useCallback(async () => {
    setConfigDirStatus('loading')
    setConfigDirError(null)
    try {
      const result = await maaApi.getConfigDir()
      if (result.success) {
        const nextConfigDir = typeof result.data === 'string'
          ? result.data
          : (result.data && typeof result.data === 'object' && 'path' in result.data && typeof (result.data as { path?: unknown }).path === 'string'
              ? (result.data as { path: string }).path
              : '')
        if (!nextConfigDir) throw new Error('服务器未返回配置目录')
        setConfigDir(nextConfigDir)
        setConfigDirStatus('ready')
        return
      }

      throw new Error(maaApi.getErrorMessage(result))
    } catch (error) {
      const detail = error instanceof Error && error.message ? error.message : '暂时无法读取配置目录'
      setConfigDir('')
      setConfigDirStatus('error')
      setConfigDirError(`配置目录读取失败: ${detail}`)
    }
  }, [])

  const loadConfig = useCallback(async () => {
    try {
      const result = await maaApi.getConfig()
      if (result.success && result.data && connectionRevisionRef.current === 0) {
        setConfigData(result.data)
      } else if (!result.success) {
        const message = `连接配置读取失败: ${maaApi.getErrorMessage(result)}`
        setConfigFeedback({ type: 'error', message })
        setStatusMessage(message, 'error')
      }
    } catch (error) {
      const message = `连接配置读取失败: ${(error as Error).message}`
      setConfigFeedback({ type: 'error', message })
      setStatusMessage(message, 'error')
    }
  }, [setStatusMessage])

  useEffect(() => {
    if (didInitializeRef.current) return
    didInitializeRef.current = true

    void Promise.allSettled([
      loadConfigDir(),
      loadConfig(),
      loadAutoUpdateConfig(),
      loadVersion(),
    ])
  }, [loadAutoUpdateConfig, loadConfig, loadConfigDir, loadVersion])

  const updateConnectionConfig = (update: (current: MaaConnectionConfig) => MaaConnectionConfig) => {
    connectionRevisionRef.current += 1
    setConfigData(update)
    setConfigFeedback(null)
  }

  const handleSave = async () => {
    if (connectionSaveInFlightRef.current) return
    const savedRevision = connectionRevisionRef.current
    const configSnapshot = { ...configData }
    connectionSaveInFlightRef.current = true
    setLoading(true)
    setConfigFeedback(null)
    setStatusMessage('正在保存配置...', 'info')
    
    try {
      const result = await maaApi.saveConfig('default', { connection: configSnapshot })

      if (result.success) {
        if (savedRevision === connectionRevisionRef.current) {
          const message = '连接配置保存成功'
          setConfigFeedback({ type: 'success', message })
          setStatusMessage(message, 'success')
        } else {
          const message = '此前连接配置已保存，当前更改尚未保存'
          setConfigFeedback({ type: 'warning', message })
          setStatusMessage(message, 'warning')
        }
      } else {
        const message = `连接配置保存失败: ${maaApi.getErrorMessage(result)}`
        setConfigFeedback({ type: 'error', message })
        setStatusMessage(message, 'error')
      }
    } catch (error) {
      const message = `连接配置保存失败: ${(error as Error).message}`
      setConfigFeedback({ type: 'error', message })
      setStatusMessage(message, 'error')
    } finally {
      connectionSaveInFlightRef.current = false
      setLoading(false)
    }
  }

  const handleReset = () => {
    updateConnectionConfig(() => ({
      adb_path: '/opt/homebrew/bin/adb',
      address: '127.0.0.1:16384',
      config: 'CompatMac',
      auto_reconnect: true,
    }))
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
    updateConnectionConfig(current => ({ ...current, adb_path: adbPath, address: device.address }))
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
    if (updateInFlightRef.current) return
    updateInFlightRef.current = true
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
      updateInFlightRef.current = false
    }
  }

  const handleUpdateCli = async () => {
    if (updateInFlightRef.current) return
    updateInFlightRef.current = true
    setUpdating(current => ({ ...current, cli: true }))
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
      setUpdating(current => ({ ...current, cli: false }))
      updateInFlightRef.current = false
    }
  }

  const handleToggleCoreVersion = async () => {
    if (updateInFlightRef.current) return
    updateInFlightRef.current = true
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
      updateInFlightRef.current = false
    }
  }

  const handleHotUpdate = async () => {
    if (updateInFlightRef.current) return
    updateInFlightRef.current = true
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
      updateInFlightRef.current = false
    }
  }

  const updateBusy = updating.core || updating.cli || hotUpdating

  const configSections = [
    { id: 'connection', name: '连接配置', icon: <Icons.Monitor /> },
    { id: 'resource', name: '资源配置', icon: <Icons.Package /> },
    { id: 'instance', name: '实例选项', icon: <Icons.Lightning /> },
  ] satisfies ConfigSection[]

  return (
    <>
      <div className="app-page app-stack-section ios-workspace-page">
        <PageHeader
          title="配置管理"
          subtitle="管理游戏连接、运行设置与资源更新"
          mobileLayout="inline"
          actions={(
            <FloatingStatusIndicator
              className="w-full overflow-hidden sm:w-auto sm:max-w-none"
              textClassName="truncate whitespace-nowrap"
            />
          )}
        />

        <Card animated delay={0.1} smoothCorners className="!p-0">
          <CardContent>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="mb-2 text-lg font-bold text-primary">配置目录</h2>
                {configDirStatus === 'error' ? (
                  <p className="break-words text-sm text-danger [overflow-wrap:anywhere]" role="alert">
                    {configDirError}
                  </p>
                ) : (
                  <p className="break-words font-mono text-sm text-secondary [overflow-wrap:anywhere]" aria-live="polite">
                    {configDirStatus === 'loading' ? '正在读取目录...' : configDir}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {configDirStatus === 'error' && (
                  <Button
                    onClick={() => void loadConfigDir()}
                    variant="outline"
                    size="sm"
                    icon={<Icons.RefreshCw className="h-4 w-4" />}
                  >
                    重试
                  </Button>
                )}
                <Button
                  onClick={handleOpenConfigDir}
                  variant="outline"
                  size="sm"
                  disabled={configDirStatus !== 'ready' || !configDir}
                >
                  打开目录
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card animated delay={0.15} smoothCorners className="!p-0">
          <CardHeader title="更新管理" />
          <CardContent>
            {/* 自动更新设置 */}
            <section className="mb-6 border-b border-[var(--app-border)] pb-6">
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
                  <div className="relative h-7 w-12 rounded-[var(--app-radius-pill)] border border-[var(--app-border-strong)] bg-[var(--app-surface-muted)] transition-colors after:absolute after:left-[3px] after:top-[3px] after:h-5 after:w-5 after:rounded-[var(--app-radius-pill)] after:border after:border-[var(--app-border)] after:bg-white after:shadow-sm after:transition-transform peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--app-accent)] peer-checked:border-[var(--app-accent)] peer-checked:bg-[var(--app-accent)] peer-checked:after:translate-x-5"></div>
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
                        disabled={updateBusy}
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

              {autoUpdateFeedback && (
                <div
                  className={`mt-4 rounded-[var(--app-radius-md)] px-3 py-2.5 text-xs leading-5 ${
                    autoUpdateFeedback.type === 'success'
                      ? 'status-success'
                      : autoUpdateFeedback.type === 'warning'
                        ? 'status-warning'
                        : 'status-danger'
                  }`}
                  role={autoUpdateFeedback.type === 'error' ? 'alert' : 'status'}
                >
                  {autoUpdateFeedback.message}
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--app-border)] pt-4">
                <p className="text-xs text-tertiary">
                  {autoUpdateDirty ? '有尚未保存的更改' : '设置会在保存后生效'}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={autoUpdateSaving}
                  loadingText="保存中..."
                  disabled={!autoUpdateDirty || autoUpdateSaving}
                  onClick={() => void saveAutoUpdateConfig(autoUpdate)}
                >
                  保存自动更新设置
                </Button>
              </div>
            </section>
            
            {/* 手动更新按钮 */}
            <div className="grid grid-cols-1 md:grid-cols-2">
              {/* 更新 MaaCore */}
              <section className="min-w-0 border-b border-[var(--app-border)] pb-5 md:border-b-0 md:border-r md:pb-0 md:pr-5">
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
                    disabled={updateBusy}
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
                    disabled={updateBusy}
                    className="app-native-button app-native-button-primary w-full px-3 text-sm sm:w-auto"
                  >
                    {versionInfo?.core.includes('beta') || versionInfo?.core.includes('alpha') ? '切换到正式版' : '切换到 Beta'}
                  </button>
                  <Button
                    onClick={handleHotUpdate}
                    disabled={updateBusy}
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
                        disabled={updateBusy}
                        className="app-native-button mt-1 !min-h-11 !border-0 !bg-transparent !px-0 !py-0 font-semibold underline underline-offset-2 shadow-none disabled:cursor-not-allowed disabled:opacity-50 lg:!min-h-0"
                      >
                        重试资源同步
                      </button>
                    )}
                  </div>
                )}
                
              </section>

              {/* 更新 MAA CLI */}
              <section className="min-w-0 pt-5 md:pl-5 md:pt-0">
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
                  disabled={updateBusy}
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
                
              </section>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-[var(--app-space-section)] lg:grid-cols-[17rem_minmax(0,1fr)]">
          {/* 配置类型选择 */}
          <div>
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
            >
              <SmoothPanel surfaceClassName="overflow-hidden">
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
              </SmoothPanel>
            </motion.div>
          </div>

          {/* 配置编辑器 */}
          <div className="min-w-0">
            <Card animated delay={0.2} smoothCorners className="!p-0">
              <CardHeader 
                title={configSections.find(s => s.id === configType)?.name || '配置'}
                actions={
                  configType === 'connection' ? (
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
                  ) : (
                    <Button
                      type="button"
                      onClick={handleOpenConfigDir}
                      variant="outline"
                      size="sm"
                    >
                      打开配置目录
                    </Button>
                  )
                }
              />
              <CardContent>
                {configType === 'connection' && (
                  <div className="space-y-5">
                    {configFeedback && (
                      <div
                        className={`rounded-[var(--app-radius-md)] px-3 py-2.5 text-xs leading-5 ${
                          configFeedback.type === 'success'
                            ? 'status-success'
                            : configFeedback.type === 'warning'
                              ? 'status-warning'
                              : 'status-danger'
                        }`}
                        role={configFeedback.type === 'error' ? 'alert' : 'status'}
                      >
                        {configFeedback.message}
                      </div>
                    )}
                    <Input
                      label="ADB 路径"
                      value={configData.adb_path}
                      onChange={(value: string) => {
                        updateConnectionConfig(current => ({ ...current, adb_path: value }))
                      }}
                      hint="ADB 可执行文件的路径"
                    />
                    <Input
                      label="连接地址"
                      value={configData.address}
                      onChange={(value: string) => {
                        updateConnectionConfig(current => ({ ...current, address: value }))
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
                        <div className={`mt-3 rounded-[var(--app-radius-md)] px-3 py-2.5 text-xs ${connectionFeedback.success ? 'status-success' : 'status-danger'}`} role={connectionFeedback.success ? 'status' : 'alert'}>
                          {connectionFeedback.message}
                        </div>
                      )}
                    </section>
                    <Select
                      label="平台配置"
                      value={configData.config}
                      onChange={(value: string) => {
                        updateConnectionConfig(current => ({ ...current, config: value }))
                      }}
                      options={[
                        { value: 'CompatMac', label: 'CompatMac (macOS)' },
                        { value: 'CompatPOSIXShell', label: 'CompatPOSIXShell (Linux)' },
                        { value: 'General', label: 'General (Windows)' }
                      ]}
                      hint="平台相关配置"
                    />
                    <section className="border-t border-[var(--app-border)] pt-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-primary">自动重连</div>
                          <div className="mt-1 text-xs text-tertiary">maa-cli 0.7.3+ 支持。开启后游戏服务断开时自动重连；关闭则保持断开，适合手动排障。</div>
                        </div>
                        <Checkbox
                          label="启用"
                          checked={configData.auto_reconnect !== false}
                          onChange={(checked: boolean) => {
                            updateConnectionConfig(current => ({ ...current, auto_reconnect: checked }))
                          }}
                        />
                      </div>
                    </section>
                  </div>
                )}
                {configType === 'resource' && (
                  <section className="py-1" aria-labelledby="resource-config-readonly-title">
                    <h3 id="resource-config-readonly-title" className="text-sm font-semibold text-primary">当前为只读</h3>
                    <p className="mt-2 text-sm leading-6 text-secondary">
                      资源来源沿用当前 MAA 配置。如需更改，请打开配置目录。
                    </p>
                  </section>
                )}
                {configType === 'instance' && (
                  <section className="py-1" aria-labelledby="instance-config-readonly-title">
                    <h3 id="instance-config-readonly-title" className="text-sm font-semibold text-primary">当前为只读</h3>
                    <p className="mt-2 text-sm leading-6 text-secondary">
                      触摸模式等实例选项沿用当前 MAA 配置。如需更改，请打开配置目录。
                    </p>
                  </section>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  )
}
