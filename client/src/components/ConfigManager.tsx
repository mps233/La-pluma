import { useState, useEffect } from 'react'
import { maaApi } from '../services/api'
import { motion } from 'framer-motion'
import Icons from './Icons'
import { PageHeader, StatusIndicator, Card, CardHeader, CardContent, Button, Input, Select, Checkbox } from './common'
import type { 
  ConfigManagerProps, 
  MaaConnectionConfig, 
  AutoUpdateConfig, 
  ConfigSection, 
  UpdateStatus 
} from '@/types/components'

interface MaaVersionInfo {
  cli: string
  core: string
  raw: string
}

interface ChangelogItem {
  version: string
  name: string
  body: string
  publishedAt: string
  htmlUrl: string
  prerelease: boolean
}

export default function ConfigManager({}: ConfigManagerProps) {
  const [statusMessage, setStatusMessage] = useState<string>('')
  const [configType, setConfigType] = useState<'connection' | 'resource' | 'instance'>('connection')
  const [configData, setConfigData] = useState<MaaConnectionConfig>({
    adb_path: 'adb',
    address: '127.0.0.1:5555',
    config: 'CompatMac',
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
  const [coreChangelog, setCoreChangelog] = useState<ChangelogItem[]>([])
  const [cliChangelog, setCliChangelog] = useState<ChangelogItem[]>([])
  const [showCoreChangelogType, setShowCoreChangelogType] = useState<'stable' | 'beta'>('stable')

  useEffect(() => {
    loadConfigDir()
    loadConfig()
    loadAutoUpdateConfig()
    loadVersion()
    loadCoreChangelog()
    loadCliChangelog()
  }, [])

  // 当版本信息加载后，根据当前版本设置默认显示的日志类型
  useEffect(() => {
    if (versionInfo) {
      const isBeta = versionInfo.core.includes('beta') || versionInfo.core.includes('alpha')
      setShowCoreChangelogType(isBeta ? 'beta' : 'stable')
    }
  }, [versionInfo])

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
        setStatusMessage(config.enabled ? `✓ 自动更新已启用，每天 ${config.time} 执行` : '✓ 自动更新已禁用')
        await new Promise(resolve => setTimeout(resolve, 1500))
        setStatusMessage('')
      } else {
        setStatusMessage(`❌ 设置失败: ${result.message}`)
        await new Promise(resolve => setTimeout(resolve, 2000))
        setStatusMessage('')
      }
    } catch (error) {
      setStatusMessage(`❌ 设置失败: ${(error as Error).message}`)
      await new Promise(resolve => setTimeout(resolve, 2000))
      setStatusMessage('')
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
        setConfigDir(result.data || '')
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
        setStatusMessage('✓ 配置保存成功')
        await new Promise(resolve => setTimeout(resolve, 1500))
        setStatusMessage('')
      } else {
        setStatusMessage(`❌ 保存失败: ${result.error}`)
        await new Promise(resolve => setTimeout(resolve, 2000))
        setStatusMessage('')
      }
    } catch (error) {
      setStatusMessage(`❌ 网络错误: ${(error as Error).message}`)
      await new Promise(resolve => setTimeout(resolve, 2000))
      setStatusMessage('')
    } finally {
      setLoading(false)
    }
  }

  const handleReset = async () => {
    setConfigData({
      adb_path: 'adb',
      address: '127.0.0.1:5555',
      config: 'CompatMac',
    })
    setStatusMessage('✓ 已重置为默认值')
    await new Promise(resolve => setTimeout(resolve, 1500))
    setStatusMessage('')
  }

  const handleUpdateCore = async () => {
    setUpdating({ ...updating, core: true })
    setStatusMessage('正在更新 MaaCore...')
    
    try {
      // 更新到当前渠道的最新版本
      // 不传版本号，后端会使用 maa update 命令
      const result = await maaApi.updateMaaCore()
      
      if (result.success) {
        setStatusMessage('✓ MaaCore 更新成功')
        await new Promise(resolve => setTimeout(resolve, 1500))
        setStatusMessage('')
        // 更新成功后重新加载版本信息和更新日志
        await loadVersion()
        await loadCoreChangelog()
      } else {
        setStatusMessage(`❌ 更新失败: ${result.error}`)
        await new Promise(resolve => setTimeout(resolve, 2000))
        setStatusMessage('')
      }
    } catch (error) {
      setStatusMessage(`❌ 网络错误: ${(error as Error).message}`)
      await new Promise(resolve => setTimeout(resolve, 2000))
      setStatusMessage('')
    } finally {
      setUpdating({ ...updating, core: false })
    }
  }

  const handleUpdateCli = async () => {
    setUpdating({ ...updating, cli: true })
    setStatusMessage('正在更新 MAA CLI...')
    
    try {
      const result = await maaApi.updateMaaCli()
      
      if (result.success) {
        setStatusMessage('✓ MAA CLI 更新成功')
        await new Promise(resolve => setTimeout(resolve, 1500))
        setStatusMessage('')
        // 更新成功后重新加载版本信息
        await loadVersion()
      } else {
        setStatusMessage(`❌ 更新失败: ${result.error}`)
        await new Promise(resolve => setTimeout(resolve, 2000))
        setStatusMessage('')
      }
    } catch (error) {
      setStatusMessage(`❌ 网络错误: ${(error as Error).message}`)
      await new Promise(resolve => setTimeout(resolve, 2000))
      setStatusMessage('')
    } finally {
      setUpdating({ ...updating, cli: false })
    }
  }

  const loadCoreChangelog = async () => {
    try {
      const result = await maaApi.getMaaCoreChangelog()
      if (result.success && result.data) {
        setCoreChangelog(result.data)
      }
    } catch (error) {
      console.error('加载 MaaCore 更新日志失败:', error)
    }
  }

  const loadCliChangelog = async () => {
    try {
      const result = await maaApi.getMaaCliChangelog()
      if (result.success && result.data) {
        setCliChangelog(result.data)
      }
    } catch (error) {
      console.error('加载 MAA CLI 更新日志失败:', error)
    }
  }

  const handleToggleCoreVersion = async () => {
    // 根据当前安装的版本判断目标渠道
    const currentIsBeta = versionInfo?.core.includes('beta') || versionInfo?.core.includes('alpha')
    const targetIsBeta = !currentIsBeta
    const targetChannel = targetIsBeta ? 'Beta' : '正式版'
    
    setUpdating({ ...updating, core: true })
    setStatusMessage(`正在切换到 ${targetChannel} 渠道...`)
    
    try {
      // 切换渠道并安装
      const versionToInstall = targetIsBeta ? 'beta' : 'stable'
      const result = await maaApi.updateMaaCore(versionToInstall)
      
      if (result.success) {
        setStatusMessage(`✓ 已切换到 ${targetChannel} 渠道`)
        await new Promise(resolve => setTimeout(resolve, 1500))
        setStatusMessage('')
        // 更新成功后重新加载版本信息和更新日志
        await loadVersion()
        await loadCoreChangelog()
      } else {
        setStatusMessage(`❌ 切换失败: ${result.error}`)
        await new Promise(resolve => setTimeout(resolve, 2000))
        setStatusMessage('')
      }
    } catch (error) {
      setStatusMessage(`❌ 网络错误: ${(error as Error).message}`)
      await new Promise(resolve => setTimeout(resolve, 2000))
      setStatusMessage('')
    } finally {
      setUpdating({ ...updating, core: false })
    }
  }

  const handleHotUpdate = async () => {
    setHotUpdating(true)
    setStatusMessage('正在热更新资源文件...')
    
    try {
      const result = await maaApi.hotUpdateResources()
      
      if (result.success) {
        setStatusMessage('✓ 资源文件更新成功')
        await new Promise(resolve => setTimeout(resolve, 1500))
        setStatusMessage('')
      } else {
        setStatusMessage(`❌ 更新失败: ${result.error}`)
        await new Promise(resolve => setTimeout(resolve, 2000))
        setStatusMessage('')
      }
    } catch (error) {
      setStatusMessage(`❌ 网络错误: ${(error as Error).message}`)
      await new Promise(resolve => setTimeout(resolve, 2000))
      setStatusMessage('')
    } finally {
      setHotUpdating(false)
    }
  }

  const configSections: ConfigSection[] = [
    { id: 'connection', name: '连接配置', icon: '🔌' },
    { id: 'resource', name: '资源配置', icon: '📦' },
    { id: 'instance', name: '实例选项', icon: '⚡' },
  ]

  return (
    <>
      <div className="p-6 space-y-6">
        <PageHeader
          icon={<Icons.CogIcon />}
          title="配置管理"
          subtitle="管理 MAA CLI 连接和运行配置"
          gradientFrom="orange-400"
          gradientVia="red-400"
          gradientTo="pink-400"
          actions={
            <StatusIndicator
              isActive={loading || updating.core || updating.cli}
              message={statusMessage}
              activeText="处理中"
              inactiveText="就绪"
              activeColor="orange-400"
            />
          }
        />

        <Card animated delay={0.1} theme="orange">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">配置目录</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 font-mono">{configDir || '加载中...'}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-500/30 bg-orange-50 dark:bg-transparent hover:bg-orange-100 dark:hover:bg-orange-500/10"
            >
              打开目录
            </Button>
          </div>
        </Card>

        <Card animated delay={0.15} theme="orange">
          <CardHeader title="更新管理" />
          <CardContent>
            {/* 自动更新设置 */}
            <div className="mb-6 rounded-2xl p-5 border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-gray-800/40">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">自动更新</h3>
                  <p className="text-xs text-gray-600 dark:text-gray-400">每天定时自动更新 MAA 组件</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoUpdate.enabled}
                    onChange={(e) => handleAutoUpdateChange('enabled', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-orange-500/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-orange-500 peer-checked:to-red-500"></div>
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
                        <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
                          资源热更新
                        </h4>
                        <p className="text-xs text-gray-600 dark:text-gray-400">同步 MaaResource 仓库的最新资源文件（活动地图、公招数据等）</p>
                      </div>
                      <Button
                        onClick={handleHotUpdate}
                        disabled={hotUpdating}
                        variant="gradient"
                        gradientFrom="orange"
                        gradientTo="red"
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
              <div className="rounded-2xl p-5 border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-gray-800/40">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                        MaaCore
                      </h3>
                      {versionInfo && (
                        <span className="text-sm font-normal text-purple-600 dark:text-purple-400">
                          {versionInfo.core}
                        </span>
                      )}
                      {versionInfo && versionInfo.core.includes('beta') && (
                        <span className="px-2 py-0.5 text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 rounded">
                          Beta
                        </span>
                      )}
                      {versionInfo && !versionInfo.core.includes('beta') && (
                        <span className="px-2 py-0.5 text-xs bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 rounded">
                          正式版
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400">更新 MAA 核心组件和资源文件</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={handleUpdateCore}
                    disabled={updating.core}
                    variant="gradient"
                    gradientFrom="orange"
                    gradientTo="red"
                    className="flex-1"
                    icon={updating.core ? (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    ) : <Icons.Download />}
                  >
                    {updating.core ? '更新中...' : '更新 MaaCore'}
                  </Button>
                  <button
                    onClick={handleToggleCoreVersion}
                    disabled={updating.core}
                    className="px-4 py-2 text-sm rounded-xl transition-colors bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {versionInfo?.core.includes('beta') || versionInfo?.core.includes('alpha') ? '切换到正式版' : '切换到 Beta'}
                  </button>
                </div>
                
                {/* 更新日志 */}
                {coreChangelog.length > 0 && (
                  <div className="mt-4">
                    {coreChangelog
                      .filter(changelog => {
                        const isBeta = changelog.prerelease || changelog.version.includes('beta') || changelog.version.includes('alpha')
                        return showCoreChangelogType === 'beta' ? isBeta : !isBeta
                      })
                      .slice(0, 1)
                      .map((changelog) => (
                        <div key={changelog.version} className="p-4 bg-white dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-white/5">
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <h4 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                                {changelog.version}
                                {changelog.prerelease && (
                                  <span className="px-2 py-0.5 text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 rounded">
                                    预发布
                                  </span>
                                )}
                                <span className="px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400 rounded">
                                  最新
                                </span>
                              </h4>
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                {new Date(changelog.publishedAt).toLocaleDateString('zh-CN', { 
                                  year: 'numeric', 
                                  month: 'long', 
                                  day: 'numeric' 
                                })}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {/* 切换按钮 */}
                              <div className="inline-flex rounded-2xl bg-gray-300 dark:bg-gray-800 p-1">
                                <button
                                  onClick={() => setShowCoreChangelogType('stable')}
                                  className={`px-2.5 py-1 text-xs font-medium rounded-xl transition-colors ${
                                    showCoreChangelogType === 'stable'
                                      ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                                      : 'text-gray-700 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                                  }`}
                                >
                                  正式版
                                </button>
                                <button
                                  onClick={() => setShowCoreChangelogType('beta')}
                                  className={`px-2.5 py-1 text-xs font-medium rounded-xl transition-colors ${
                                    showCoreChangelogType === 'beta'
                                      ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                                      : 'text-gray-700 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                                  }`}
                                >
                                  Beta
                                </button>
                              </div>
                              <a
                                href={changelog.htmlUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                              >
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                                </svg>
                                GitHub
                              </a>
                            </div>
                          </div>
                          <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap max-h-96 overflow-y-auto">
                            {changelog.body || '无更新说明'}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {/* 更新 MAA CLI */}
              <div className="rounded-2xl p-5 border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-gray-800/40">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                        MAA CLI
                      </h3>
                      {versionInfo && (
                        <span className="text-sm font-normal text-blue-600 dark:text-blue-400">
                          {versionInfo.cli}
                        </span>
                      )}
                      <span className="px-2 py-0.5 text-xs bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 rounded">
                        正式版
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400">通过 Homebrew 更新 MAA 命令行工具</p>
                  </div>
                </div>
                <Button
                  onClick={handleUpdateCli}
                  disabled={updating.cli}
                  variant="gradient"
                  gradientFrom="orange"
                  gradientTo="red"
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
                
                {/* 更新日志 */}
                {cliChangelog.length > 0 && (
                  <div className="mt-4 space-y-3 max-h-96 overflow-y-auto">
                    {cliChangelog.map((changelog, index) => (
                      <div key={changelog.version} className="p-4 bg-white dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-white/5">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h4 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                              {changelog.version}
                              {index === 0 && (
                                <span className="px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400 rounded">
                                  最新
                                </span>
                              )}
                            </h4>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              {new Date(changelog.publishedAt).toLocaleDateString('zh-CN', { 
                                year: 'numeric', 
                                month: 'long', 
                                day: 'numeric' 
                              })}
                            </p>
                          </div>
                          <a
                            href={changelog.htmlUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                          >
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                            </svg>
                            GitHub
                          </a>
                        </div>
                        <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap max-h-96 overflow-y-auto">
                          {changelog.body || '无更新说明'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* 配置类型选择 */}
          <div className="lg:col-span-1">
            <motion.div 
              className="rounded-3xl border border-orange-200 dark:border-orange-500/20 overflow-hidden bg-gradient-to-br from-orange-50/50 to-red-50/50 dark:from-orange-900/5 dark:to-red-900/5"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
            >
              <div className="px-5 py-4 border-b border-gray-200 dark:border-white/10">
                <h3 className="font-bold text-gray-900 dark:text-white">配置类型</h3>
              </div>
              <div className="p-3">
                {configSections.map((section, index) => (
                  <motion.button
                    key={section.id}
                    onClick={() => setConfigType(section.id)}
                    className={`
                      w-full flex items-center space-x-3 px-4 py-3 rounded-2xl text-left transition-all mb-2
                      ${configType === section.id
                        ? 'bg-gradient-to-r from-orange-100 to-red-100 dark:from-orange-500/20 dark:to-red-500/20 text-orange-700 dark:text-orange-300 border border-orange-300 dark:border-orange-500/30 shadow-[0_4px_12px_rgba(251,146,60,0.15)]'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5 hover:shadow-[0_4px_12px_rgba(0,0,0,0.15)] border border-transparent'
                      }
                    `}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3 + index * 0.1 }}
                    whileHover={{ x: 4 }}
                  >
                    <span className="text-xl">{section.icon}</span>
                    <span className="text-sm font-medium">{section.name}</span>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          </div>

          {/* 配置编辑器 */}
          <div className="lg:col-span-3">
            <Card animated delay={0.2} theme="orange">
              <CardHeader 
                title={configSections.find(s => s.id === configType)?.name || '配置'}
                actions={
                  <div className="flex items-center space-x-2">
                    <Button
                      onClick={handleReset}
                      disabled={loading}
                      variant="outline"
                      size="sm"
                    >
                      重置
                    </Button>
                    <Button
                      onClick={handleSave}
                      disabled={loading}
                      variant="outline"
                      size="sm"
                      className="bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-500/30 hover:bg-orange-200 dark:hover:bg-orange-500/30"
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
                      onChange={(value: string) => setConfigData({ ...configData, address: value })}
                      hint="模拟器连接地址，格式: IP:端口"
                    />
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
