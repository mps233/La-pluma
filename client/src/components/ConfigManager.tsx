import { useState, useEffect, useRef, useCallback } from 'react'
import { maaApi } from '../services/api'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  Cable,
  Clock3,
  Download,
  FolderOpen,
  LockKeyhole,
  MonitorSmartphone,
  PackageOpen,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import { PageHeader, Card, CardHeader, CardContent, Button, Input, Select, Checkbox, Switch } from './common'
import { useStatusStore } from '../store/statusStore'
import FloatingStatusIndicator from './FloatingStatusIndicator'
import { useFluidTabIndicator } from '../hooks/useFluidTabIndicator'
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

const CONFIG_SECTION_IDS = ['connection', 'resource', 'instance'] as const
type ConfigSectionId = typeof CONFIG_SECTION_IDS[number]

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
  const shouldReduceMotion = useReducedMotion()
  const [configType, setConfigType] = useState<ConfigSectionId>(() => {
    const saved = localStorage.getItem('laPlumaConfigSection')
    return CONFIG_SECTION_IDS.includes(saved as ConfigSectionId)
      ? saved as ConfigSectionId
      : 'connection'
  })
  const {
    containerRef: configTabsRef,
    activeRect: activeConfigRect,
    setTabRef: setConfigTabRef,
    handleTabKeyDown: handleConfigTabKeyDown,
  } = useFluidTabIndicator(configType)
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
        handleConfigTypeChange(section as ConfigSectionId)
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

  const handleConfigTypeChange = (section: ConfigSectionId) => {
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
    {
      id: 'connection',
      name: '连接',
      description: 'ADB 与模拟器',
      icon: <MonitorSmartphone aria-hidden="true" />,
    },
    {
      id: 'resource',
      name: '资源',
      description: '资源来源与目录',
      icon: <PackageOpen aria-hidden="true" />,
    },
    {
      id: 'instance',
      name: '实例',
      description: '运行与触控选项',
      icon: <SlidersHorizontal aria-hidden="true" />,
    },
  ] satisfies Array<ConfigSection & { description: string }>

  return (
    <div className="app-page app-stack-section ios-workspace-page" data-page="config">
      <PageHeader
        title="配置"
        subtitle="连接设备、管理运行选项与组件更新"
        mobileLayout="inline"
        actions={(
          <FloatingStatusIndicator
            className="w-full overflow-hidden sm:w-auto"
            textClassName="truncate whitespace-nowrap"
          />
        )}
      />

      <div className="app-workspace-segments app-liquid-tab-pill w-full" data-config-sections>
        <div
          ref={configTabsRef}
          className="app-workspace-segment-list grid-cols-3"
          role="toolbar"
          aria-label="配置类型"
        >
          {activeConfigRect.width > 0 && (
            <motion.div
              data-testid="config-section-highlight"
              aria-hidden="true"
              className="app-workspace-segment-indicator"
              initial={false}
              animate={{
                x: activeConfigRect.x,
                y: activeConfigRect.y,
                width: activeConfigRect.width,
                height: activeConfigRect.height,
              }}
              transition={shouldReduceMotion
                ? { duration: 0 }
                : { type: 'spring', stiffness: 420, damping: 38, mass: 0.72 }}
            />
          )}
          {configSections.map(section => {
            const selected = configType === section.id
            return (
              <button
                key={section.id}
                ref={element => setConfigTabRef(section.id)(element)}
                type="button"
                onClick={() => handleConfigTypeChange(section.id)}
                onKeyDown={event => handleConfigTabKeyDown(
                  event,
                  CONFIG_SECTION_IDS,
                  handleConfigTypeChange,
                )}
                aria-pressed={selected}
                tabIndex={selected ? 0 : -1}
                className={`app-workspace-segment min-h-11 ${selected ? 'is-selected' : ''}`}
              >
                <span className="app-workspace-segment-icon">{section.icon}</span>
                <span className="app-workspace-segment-copy">
                  <span>{section.name}</span>
                  <small>{section.description}</small>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="config-workspace-grid grid min-w-0 gap-[var(--app-space-section)] xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)] xl:items-start">
        <div className="config-workspace-primary app-stack-section min-w-0">
      <Card animated delay={0.08} smoothCorners className="config-editor-card !p-0">
        <CardHeader
          title={configSections.find(section => section.id === configType)?.name || '配置'}
          actions={configType === 'connection' ? (
            <div className="flex items-center gap-2">
              <Button
                onClick={handleReset}
                disabled={loading}
                variant="outline"
                size="sm"
                icon={<RotateCcw size={16} aria-hidden="true" />}
              >
                重置
              </Button>
              <Button
                onClick={handleSave}
                loading={loading}
                loadingText="保存中"
                variant="primary"
                size="sm"
                icon={<Save size={16} aria-hidden="true" />}
              >
                保存
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              onClick={handleOpenConfigDir}
              variant="outline"
              size="sm"
              disabled={configDirStatus !== 'ready' || !configDir}
              icon={<FolderOpen size={16} aria-hidden="true" />}
            >
              打开目录
            </Button>
          )}
        />
        <CardContent>
          {configType === 'connection' && (
            <div className="app-stack-card">
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

              <div className="grid min-w-0 gap-[var(--app-space-card)] md:grid-cols-2">
                <Input
                  label="ADB 路径"
                  value={configData.adb_path}
                  onChange={(value: string) => {
                    updateConnectionConfig(current => ({ ...current, adb_path: value }))
                  }}
                  hint="ADB 可执行文件的完整路径"
                />
                <Input
                  label="连接地址"
                  value={configData.address}
                  onChange={(value: string) => {
                    updateConnectionConfig(current => ({ ...current, address: value }))
                    setConnectionFeedback(null)
                  }}
                  hint="模拟器地址，例如 127.0.0.1:16384"
                />
              </div>

              <section className="surface-soft rounded-[var(--app-radius-lg)] p-[var(--app-space-panel)]" aria-label="模拟器查找与连接测试">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="icon-well flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--app-radius-md)] brand-text">
                      <Cable size={18} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-primary">模拟器连接</h3>
                      <p className="mt-1 text-xs leading-5 text-tertiary">查找本机模拟器，或测试当前连接地址。</p>
                    </div>
                  </div>
                  <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      loading={discoveringDevices}
                      loadingText="查找中"
                      onClick={() => void handleDiscoverDevices()}
                      className="flex-1 sm:flex-none"
                      icon={<Search size={16} aria-hidden="true" />}
                    >
                      查找模拟器
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      loading={testingConnection}
                      loadingText="测试中"
                      onClick={() => void handleTestConnection()}
                      className="flex-1 sm:flex-none"
                      icon={<Cable size={16} aria-hidden="true" />}
                    >
                      测试连接
                    </Button>
                  </div>
                </div>

                {discoveryMessage && (
                  <p className="mt-3 text-xs text-secondary" role="status">{discoveryMessage}</p>
                )}

                {discoveredDevices.length > 0 && (
                  <div className="mt-3 divide-y divide-[var(--app-border)] overflow-hidden rounded-[var(--app-radius-md)] bg-[var(--app-surface)] shadow-[inset_0_0_0_1px_var(--app-border)]">
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
                          className="flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--app-accent-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-primary">{device.address}</span>
                            <span className="mt-0.5 block truncate text-xs text-tertiary">{device.details || (device.source === 'adb' ? 'ADB 已识别设备' : device.source === 'emulator-adb' ? '模拟器内置 ADB' : '本机端口')}</span>
                          </span>
                          <span className="shrink-0 rounded-[var(--app-radius-pill)] bg-[var(--app-surface-muted)] px-2 py-1 text-xs text-secondary">{stateLabel}</span>
                        </button>
                      )
                    })}
                  </div>
                )}

                {hasSearchedDevices && !discoveredDevices.length && (
                  <p className="mt-3 text-xs leading-5 text-tertiary">未找到已连接设备。启动模拟器后重新查找，或手动填写连接地址。</p>
                )}

                {connectionFeedback && (
                  <div className={`mt-3 rounded-[var(--app-radius-md)] px-3 py-2.5 text-xs ${connectionFeedback.success ? 'status-success' : 'status-danger'}`} role={connectionFeedback.success ? 'status' : 'alert'}>
                    {connectionFeedback.message}
                  </div>
                )}
              </section>

              <div className="grid min-w-0 gap-[var(--app-space-card)] md:grid-cols-2 md:items-end">
                <Select
                  label="平台配置"
                  value={configData.config}
                  onChange={(value: string) => {
                    updateConnectionConfig(current => ({ ...current, config: value }))
                  }}
                  options={[
                    { value: 'CompatMac', label: 'CompatMac (macOS)' },
                    { value: 'CompatPOSIXShell', label: 'CompatPOSIXShell (Linux)' },
                    { value: 'General', label: 'General (Windows)' },
                  ]}
                  hint="选择与服务器系统匹配的平台预设"
                />
                <div className="surface-soft flex min-h-20 items-center justify-between gap-3 rounded-[var(--app-radius-lg)] px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-primary">自动重连</div>
                    <div className="mt-1 text-xs leading-5 text-tertiary">连接中断后自动尝试恢复</div>
                  </div>
                  <Switch
                    label="启用自动重连"
                    checked={configData.auto_reconnect !== false}
                    onChange={(checked: boolean) => {
                      updateConnectionConfig(current => ({ ...current, auto_reconnect: checked }))
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {configType === 'resource' && (
            <section className="surface-soft flex items-start gap-3 rounded-[var(--app-radius-lg)] p-[var(--app-space-panel)]" aria-labelledby="resource-config-readonly-title">
              <span className="icon-well flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--app-radius-md)] brand-text">
                <LockKeyhole size={18} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h3 id="resource-config-readonly-title" className="text-sm font-semibold text-primary">资源配置由 MAA 管理</h3>
                <p className="mt-1 text-sm leading-6 text-secondary">当前资源来源保持不变。需要调整时，可打开配置目录编辑对应文件。</p>
              </div>
            </section>
          )}

          {configType === 'instance' && (
            <section className="surface-soft flex items-start gap-3 rounded-[var(--app-radius-lg)] p-[var(--app-space-panel)]" aria-labelledby="instance-config-readonly-title">
              <span className="icon-well flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--app-radius-md)] brand-text">
                <LockKeyhole size={18} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h3 id="instance-config-readonly-title" className="text-sm font-semibold text-primary">实例选项由 MAA 管理</h3>
                <p className="mt-1 text-sm leading-6 text-secondary">触摸模式等实例选项保持当前设置。需要调整时，可打开配置目录编辑对应文件。</p>
              </div>
            </section>
          )}
        </CardContent>
      </Card>

      <Card animated delay={0.12} smoothCorners className="config-directory-card !p-0">
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="icon-well flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--app-radius-md)] brand-text">
                <FolderOpen size={20} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-primary">配置目录</h2>
                {configDirStatus === 'error' ? (
                  <p className="mt-1 break-words text-sm text-danger [overflow-wrap:anywhere]" role="alert">{configDirError}</p>
                ) : (
                  <p className="mt-1 break-words font-mono text-xs leading-5 text-secondary [overflow-wrap:anywhere]" aria-live="polite">
                    {configDirStatus === 'loading' ? '正在读取目录...' : configDir}
                  </p>
                )}
              </div>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              {configDirStatus === 'error' && (
                <Button
                  onClick={() => void loadConfigDir()}
                  variant="outline"
                  size="sm"
                  className="flex-1 sm:flex-none"
                  icon={<RefreshCw size={16} aria-hidden="true" />}
                >
                  重试
                </Button>
              )}
              <Button
                onClick={handleOpenConfigDir}
                variant="outline"
                size="sm"
                className="flex-1 sm:flex-none"
                disabled={configDirStatus !== 'ready' || !configDir}
                icon={<FolderOpen size={16} aria-hidden="true" />}
              >
                打开目录
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
        </div>

        <div className="config-workspace-secondary app-stack-section min-w-0">
      <Card animated delay={0.16} smoothCorners className="config-update-card !p-0">
        <CardHeader title="组件更新" />
        <CardContent className="app-stack-card">
          <section className="surface-soft rounded-[var(--app-radius-lg)] p-[var(--app-space-panel)]">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="icon-well flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--app-radius-md)] brand-text">
                  <Clock3 size={18} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-primary">自动更新</h3>
                  <p className="mt-1 text-xs leading-5 text-tertiary">每天按设定时间更新所选组件</p>
                </div>
              </div>
              <Switch
                checked={autoUpdate.enabled}
                onChange={checked => handleAutoUpdateChange('enabled', checked)}
                label="启用自动更新"
              />
            </div>

            <AnimatePresence initial={false}>
              {autoUpdate.enabled && (
                <motion.div
                  initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                  transition={{ duration: shouldReduceMotion ? 0.12 : 0.2 }}
                  className="mt-4 grid gap-4 border-t border-[var(--app-border)] pt-4 md:grid-cols-[12rem_minmax(0,1fr)] md:items-end xl:grid-cols-1 xl:items-stretch"
                >
                  <Input
                    type="text"
                    label="更新时间"
                    value={autoUpdate.time}
                    onChange={(value: string) => handleAutoUpdateChange('time', value)}
                    placeholder="HH:MM"
                    className="max-w-48"
                  />
                  <div className="flex min-h-11 flex-wrap items-center gap-x-5 gap-y-2">
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
                </motion.div>
              )}
            </AnimatePresence>

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
              <p className="text-xs text-tertiary">{autoUpdateDirty ? '有尚未保存的更改' : '设置会在保存后生效'}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={autoUpdateSaving}
                loadingText="保存中"
                disabled={!autoUpdateDirty || autoUpdateSaving}
                onClick={() => void saveAutoUpdateConfig(autoUpdate)}
                icon={<Save size={16} aria-hidden="true" />}
              >
                保存自动更新
              </Button>
            </div>
          </section>

          <div className="grid gap-[var(--app-space-card)] md:grid-cols-2 xl:grid-cols-1">
            <section className="surface-soft flex min-w-0 flex-col rounded-[var(--app-radius-lg)] p-[var(--app-space-panel)]">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-primary">MaaCore</h3>
                {versionInfo && <span className="text-sm brand-text">{versionInfo.core}</span>}
                {versionInfo && (
                  <span className={`rounded-[var(--app-radius-pill)] px-2 py-1 text-xs ${versionInfo.core.includes('beta') || versionInfo.core.includes('alpha') ? 'status-warning' : 'status-success'}`}>
                    {versionInfo.core.includes('beta') || versionInfo.core.includes('alpha') ? '测试版' : '正式版'}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs leading-5 text-secondary">核心组件与游戏资源</p>
              {versionInfo?.resource && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-tertiary">
                    资源更新：{versionInfo.resource.lastUpdated
                      ? new Date(versionInfo.resource.lastUpdated.replace(' ', 'T')).toLocaleString('zh-CN', { hour12: false })
                      : '未知'}
                  </span>
                  <span className={`rounded-[var(--app-radius-pill)] px-2 py-1 font-medium ${versionInfo.resource.status === 'current' ? 'status-success' : 'status-warning'}`}>
                    {versionInfo.resource.status === 'current' ? '资源正常' : '需要同步'}
                  </span>
                </div>
              )}
              {versionInfo?.resource && versionInfo.resource.status !== 'current' && (
                <p className="mt-2 text-xs leading-5 text-[var(--app-warning)]">{versionInfo.resource.message}</p>
              )}
              <div className="mt-auto grid gap-2 pt-4 sm:grid-cols-2">
                <Button
                  onClick={handleUpdateCore}
                  disabled={updateBusy}
                  loading={updating.core}
                  loadingText="更新中"
                  variant="primary"
                  className="w-full"
                  icon={<Download size={16} aria-hidden="true" />}
                >
                  更新 MaaCore
                </Button>
                <Button
                  type="button"
                  onClick={handleToggleCoreVersion}
                  disabled={updateBusy}
                  variant="secondary"
                  className="w-full"
                  icon={<RefreshCw size={16} aria-hidden="true" />}
                >
                  {versionInfo?.core.includes('beta') || versionInfo?.core.includes('alpha') ? '切换正式版' : '切换测试版'}
                </Button>
                <Button
                  onClick={handleHotUpdate}
                  disabled={updateBusy}
                  loading={hotUpdating}
                  loadingText="同步中"
                  variant="outline"
                  className="w-full sm:col-span-2"
                  icon={<RefreshCw size={16} aria-hidden="true" />}
                >
                  仅同步游戏资源
                </Button>
              </div>
            </section>

            <section className="surface-soft flex min-w-0 flex-col rounded-[var(--app-radius-lg)] p-[var(--app-space-panel)]">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-primary">MAA CLI</h3>
                {versionInfo && <span className="text-sm brand-text">{versionInfo.cli}</span>}
                <span className="status-success rounded-[var(--app-radius-pill)] px-2 py-1 text-xs">正式版</span>
              </div>
              <p className="mt-1 text-xs leading-5 text-secondary">命令行工具与任务运行入口</p>
              <div className="mt-auto pt-4">
                <Button
                  onClick={handleUpdateCli}
                  disabled={updateBusy}
                  loading={updating.cli}
                  loadingText="更新中"
                  variant="primary"
                  fullWidth
                  icon={<Download size={16} aria-hidden="true" />}
                >
                  更新 MAA CLI
                </Button>
              </div>
            </section>
          </div>

          {updateFeedback && (
            <div className={`rounded-[var(--app-radius-md)] px-3 py-2.5 text-xs leading-5 ${updateFeedback.type === 'success' ? 'status-success' : 'status-warning'}`} role={updateFeedback.type === 'error' ? 'alert' : 'status'}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p>{updateFeedback.message}</p>
                {updateFeedback.resourceRetry && (
                  <Button
                    type="button"
                    onClick={handleHotUpdate}
                    disabled={updateBusy}
                    variant="ghost"
                    size="sm"
                    className="!min-h-11 lg:!min-h-0"
                    icon={<RefreshCw size={16} aria-hidden="true" />}
                  >
                    重试资源同步
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
        </div>
      </div>
    </div>
  )
}
