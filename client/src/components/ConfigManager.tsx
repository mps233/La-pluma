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
  const [autoUpdate, setAutoUpdate] = useState<AutoUpdateConfig>({
    enabled: false,
    time: '04:00',
    updateCore: true,
    updateCli: true
  })

  useEffect(() => {
    loadConfigDir()
    loadConfig()
    loadAutoUpdateConfig()
  }, [])

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
      const result = await maaApi.updateMaaCore()
      
      if (result.success) {
        setStatusMessage('✓ MaaCore 更新成功')
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

        <Card animated delay={0.1}>
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

        <Card animated delay={0.15}>
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
                  <Input
                    type="text"
                    label="更新时间"
                    value={autoUpdate.time}
                    onChange={(value: string) => handleAutoUpdateChange('time', value)}
                    placeholder="HH:MM"
                  />
                  
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
                </motion.div>
              )}
            </div>
            
            {/* 手动更新按钮 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 更新 MaaCore */}
              <div className="rounded-2xl p-5 border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-gray-800/40">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">MaaCore</h3>
                    <p className="text-xs text-gray-600 dark:text-gray-400">更新 MAA 核心组件和资源文件</p>
                  </div>
                </div>
                <Button
                  onClick={handleUpdateCore}
                  disabled={updating.core}
                  variant="gradient"
                  gradientFrom="orange-500"
                  gradientTo="red-500"
                  fullWidth
                  icon={updating.core ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : <Icons.Download />}
                >
                  {updating.core ? '更新中...' : '更新 MaaCore'}
                </Button>
              </div>

              {/* 更新 MAA CLI */}
              <div className="rounded-2xl p-5 border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-gray-800/40">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">MAA CLI</h3>
                    <p className="text-xs text-gray-600 dark:text-gray-400">通过 Homebrew 更新 MAA 命令行工具</p>
                  </div>
                </div>
                <Button
                  onClick={handleUpdateCli}
                  disabled={updating.cli}
                  variant="gradient"
                  gradientFrom="orange-500"
                  gradientTo="red-500"
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

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* 配置类型选择 */}
          <div className="lg:col-span-1">
            <motion.div 
              className="rounded-3xl border border-gray-200 dark:border-white/10 overflow-hidden bg-white dark:bg-gray-900/60"
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
