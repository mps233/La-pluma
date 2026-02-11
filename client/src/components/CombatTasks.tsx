import { useState, useEffect } from 'react'
import { maaApi } from '../services/api'
import { motion } from 'framer-motion'
import Icons from './Icons'
import { PageHeader, StatusIndicator, Button } from './common'
import type {
  CombatTasksProps,
  CombatTask,
  CombatAdvancedOption,
  CombatTaskInputs,
  CombatAdvancedParams,
  AutoFormationConfig,
  CopilotSetInfo,
  CopilotSearchResult,
  ParadoxSearchResult
} from '@/types/components'

export default function CombatTasks(_props: CombatTasksProps) {
  const [isRunning, setIsRunning] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string>('')
  const [taskInputs, setTaskInputs] = useState<CombatTaskInputs>({})
  const [copilotSetInfo, setCopilotSetInfo] = useState<CopilotSetInfo | null>(null)
  const [isLoadingSet, setIsLoadingSet] = useState(false)
  const [advancedParams, setAdvancedParams] = useState<CombatAdvancedParams>({})
  const [autoFormation, setAutoFormation] = useState<AutoFormationConfig>({ copilot: true, paradoxcopilot: true })
  
  // 悖论模拟搜索相关状态
  const [paradoxSearchName, setParadoxSearchName] = useState('')
  const [paradoxSearchResult, setParadoxSearchResult] = useState<ParadoxSearchResult | null>(null)
  const [isSearchingParadox, setIsSearchingParadox] = useState(false)
  
  // 普通关卡搜索相关状态
  const [copilotSearchStage, setCopilotSearchStage] = useState('')
  const [copilotSearchResult, setCopilotSearchResult] = useState<CopilotSearchResult | null>(null)
  const [isSearchingCopilot, setIsSearchingCopilot] = useState(false)

  // 页面加载时从服务器或 localStorage 加载配置和恢复执行状态
  useEffect(() => {
    // 从后端获取真实的任务执行状态
    const checkBackendStatus = async () => {
      try {
        const result = await maaApi.getTaskStatus()
        if (result.success && result.data.isRunning) {
          // 后端确实有任务在运行
          const { taskName, startTime, taskType } = result.data
          
          // 只恢复属于自动战斗的任务
          if (taskType === 'combat') {
            const elapsedMinutes = (Date.now() - startTime) / 1000 / 60
            setIsRunning(true)
            if (elapsedMinutes > 5) {
              setStatusMessage(`${taskName} 可能已完成（已运行 ${Math.floor(elapsedMinutes)} 分钟）`)
            } else {
              setStatusMessage(`正在执行: ${taskName}`)
            }
            
            // 启动轮询，持续检查任务状态
            const pollInterval = setInterval(async () => {
              try {
                const statusResult = await maaApi.getTaskStatus()
                if (statusResult.success && !statusResult.data.isRunning) {
                  // 任务已完成
                  setIsRunning(false)
                  setStatusMessage('✓ 任务已完成')
                  await new Promise(resolve => setTimeout(resolve, 2000))
                  setStatusMessage('')
                  clearInterval(pollInterval)
                }
              } catch (error) {
                clearInterval(pollInterval)
              }
            }, 2000) // 每2秒检查一次
            
            // 组件卸载时清除轮询
            return () => clearInterval(pollInterval)
          }
        }
      } catch (error) {
        // 静默失败，不影响用户体验
      }
    }
    
    checkBackendStatus()
    
    // 加载保存的配置 - 优先从服务器加载
    const loadConfig = async () => {
      try {
        const serverConfig = await maaApi.loadUserConfig('combat-tasks')
        if (serverConfig.success && serverConfig.data) {
          const { taskInputs: inputs, advancedParams: advanced, autoFormation: formation } = serverConfig.data
          if (inputs) {
            setTaskInputs(inputs)
            localStorage.setItem('combatTaskInputs', JSON.stringify(inputs))
          }
          if (advanced) {
            setAdvancedParams(advanced)
            localStorage.setItem('combatAdvancedParams', JSON.stringify(advanced))
          }
          if (formation) {
            setAutoFormation(formation)
            localStorage.setItem('combatAutoFormation', JSON.stringify(formation))
          }
          return
        }
      } catch (error) {
        // 服务器加载失败，静默处理
      }
      
      // 服务器加载失败，从 localStorage 加载
      const savedInputs = localStorage.getItem('combatTaskInputs')
      const savedAdvanced = localStorage.getItem('combatAdvancedParams')
      const savedFormation = localStorage.getItem('combatAutoFormation')
      
      if (savedInputs) {
        setTaskInputs(JSON.parse(savedInputs))
      }
      if (savedAdvanced) {
        setAdvancedParams(JSON.parse(savedAdvanced))
      }
      if (savedFormation) {
        setAutoFormation(JSON.parse(savedFormation))
      }
    }
    
    loadConfig()
  }, [])
  
  // 自动保存配置
  useEffect(() => {
    localStorage.setItem('combatTaskInputs', JSON.stringify(taskInputs))
    // 同时保存到服务器（静默失败）
    maaApi.saveUserConfig('combat-tasks', { taskInputs, advancedParams, autoFormation }).catch(() => {})
  }, [taskInputs, advancedParams, autoFormation])
  
  useEffect(() => {
    localStorage.setItem('combatAdvancedParams', JSON.stringify(advancedParams))
  }, [advancedParams])
  
  useEffect(() => {
    localStorage.setItem('combatAutoFormation', JSON.stringify(autoFormation))
  }, [autoFormation])

  const tasks: CombatTask[] = [
    { 
      id: 'copilot', 
      name: '自动抄作业', 
      command: 'copilot', 
      placeholder: 'maa://1234 或本地文件路径', 
      icon: <Icons.Document />, 
      hasAdvanced: true,
      description: '使用作业自动完成关卡，支持单个作业和作业集'
    },
    { 
      id: 'ssscopilot', 
      name: '保全派驻', 
      command: 'ssscopilot', 
      placeholder: 'maa://1234 或本地文件路径', 
      icon: <Icons.Shield />, 
      hasAdvanced: true,
      description: '自动保全派驻作业'
    },
    { 
      id: 'paradoxcopilot', 
      name: '悖论模拟', 
      command: 'paradoxcopilot', 
      placeholder: 'maa://1234 或本地文件路径', 
      icon: <Icons.Puzzle />, 
      hasAdvanced: false,
      description: '自动悖论模拟作业'
    },
  ]

  const getAdvancedOptions = (taskId: string): CombatAdvancedOption[] => {
    const options: Record<string, CombatAdvancedOption[]> = {
      copilot: [
        { key: 'ignoreRequirements', label: '忽略干员要求', type: 'checkbox', param: '--ignore-requirements' },
        { key: 'formationIndex', label: '编队选择', type: 'select', param: '--formation-index', options: [
          { value: '', label: '当前编队' },
          { value: '1', label: '编队 1' },
          { value: '2', label: '编队 2' },
          { value: '3', label: '编队 3' },
          { value: '4', label: '编队 4' },
        ]},
        { key: 'addTrust', label: '按信赖值填充空位', type: 'checkbox', param: '--add-trust' },
        { key: 'useSanityPotion', label: '理智不足时使用理智药', type: 'checkbox', param: '--use-sanity-potion' },
        { key: 'supportUsage', label: '助战使用模式', type: 'select', param: '--support-unit-usage', options: [
          { value: '0', label: '不使用助战' },
          { value: '1', label: '缺一个时使用' },
          { value: '2', label: '使用指定助战' },
          { value: '3', label: '使用随机助战' },
        ]},
        { key: 'supportName', label: '助战干员名称', type: 'text', param: '--support-unit-name', placeholder: '干员名称' },
      ],
      ssscopilot: [
        { key: 'loopTimes', label: '循环次数', type: 'number', param: '--loop-times', placeholder: '1' },
      ],
    }
    return options[taskId] || []
  }

  const buildCommandParams = (task: CombatTask): string => {
    let params = taskInputs[task.id] || ''
    
    // 处理多行输入
    if ((task.id === 'copilot' || task.id === 'paradoxcopilot') && params.includes('\n')) {
      const uris = params.split('\n').filter(line => line.trim())
      params = uris.join(' ')
    }
    
    // 作业集自动添加 s 后缀
    if (task.id === 'copilot' && copilotSetInfo?.type === 'set' && copilotSetInfo?.autoAddS) {
      params = params.replace(/maa:\/\/(\d+)(?!s)/g, 'maa://$1s')
    }
    
    // copilot 任务根据开关决定是否添加 --formation
    // 注意：paradoxcopilot 不支持 --formation 参数
    if (task.id === 'copilot' && autoFormation[task.id]) {
      params = params ? `${params} --formation` : '--formation'
    }
    
    // 添加高级参数
    const advanced = advancedParams[task.id] || {}
    const options = getAdvancedOptions(task.id)
    
    // 先处理突袭模式（如果有）
    if (task.id === 'copilot' && advanced.raid !== undefined && advanced.raid !== '0') {
      params += ` --raid ${advanced.raid}`
    }
    
    options.forEach(option => {
      const value = advanced[option.key]
      if (value !== undefined && value !== '' && value !== false) {
        if (option.type === 'checkbox' && value === true) {
          params += ` ${option.param}`
        } else if (option.type !== 'checkbox') {
          params += ` ${option.param} ${value}`
        }
      }
    })
    
    return params
  }

  const handleExecute = async (task: CombatTask) => {
    setIsRunning(true)
    setStatusMessage(`正在执行: ${task.name}`)
    
    try {
      const params = buildCommandParams(task)
      const result = await maaApi.executePredefinedTask(task.command, params, null, null, task.name, 'combat')
      
      if (result.success) {
        setStatusMessage(`✓ ${task.name} 执行成功`)
        await new Promise(resolve => setTimeout(resolve, 2000))
        setStatusMessage('')
      } else {
        setStatusMessage(`❌ 执行失败: ${result.error}`)
        await new Promise(resolve => setTimeout(resolve, 2000))
        setStatusMessage('')
      }
    } catch (error) {
      setStatusMessage(`❌ 网络错误: ${(error as Error).message}`)
      await new Promise(resolve => setTimeout(resolve, 2000))
      setStatusMessage('')
    } finally {
      setTimeout(() => {
        setIsRunning(false)
      }, 1000)
    }
  }

  const handleInputChange = (taskId: string, value: string) => {
    setTaskInputs({ ...taskInputs, [taskId]: value })
    if (taskId === 'copilot') {
      setCopilotSetInfo(null)
    }
  }

  const handleAdvancedChange = (taskId: string, key: string, value: string | number | boolean) => {
    setAdvancedParams({
      ...advancedParams,
      [taskId]: {
        ...(advancedParams[taskId] || {}),
        [key]: value
      }
    })
  }

  const handlePreviewCopilotSet = async () => {
    const input = taskInputs['copilot'] || ''
    const match = input.trim().match(/^maa:\/\/(\d+)(s?)$/)
    
    if (!match) {
      setStatusMessage('❌ 请输入有效的作业 URI（如: maa://26766）')
      await new Promise(resolve => setTimeout(resolve, 2000))
      setStatusMessage('')
      return
    }
    
    const copilotId = match[1]
    const hasS = match[2] === 's'
    setIsLoadingSet(true)
    setStatusMessage('正在获取作业信息...')
    
    try {
      const copilotResponse = await fetch(`https://prts.maa.plus/copilot/get/${copilotId}`)
      
      if (copilotResponse.ok) {
        const copilotData = await copilotResponse.json()
        if (copilotData.status_code === 200 && copilotData.data) {
          const content = JSON.parse(copilotData.data.content)
          setCopilotSetInfo({
            type: 'single',
            id: copilotId!,
            name: content.doc?.title || '未命名作业',
            stage: content.stage_name,
            operators: content.opers?.map((op: any) => op.name).join('、') || '未知'
          })
          setStatusMessage(`✓ 找到作业：${content.doc?.title || content.stage_name}`)
          await new Promise(resolve => setTimeout(resolve, 1500))
          setStatusMessage('')
        } else if (copilotData.status_code === 404) {
          setCopilotSetInfo({
            type: 'set',
            id: copilotId!,
            name: '作业集',
            note: '这是一个作业集，包含多个关卡。执行时会自动添加 "s" 后缀。',
            autoAddS: !hasS
          })
          setStatusMessage(`识别为作业集 ID: ${copilotId}${!hasS ? '（将自动添加 s 后缀）' : ''}`)
          await new Promise(resolve => setTimeout(resolve, 1500))
          setStatusMessage('')
        } else {
          setStatusMessage('❌ 作业不存在')
          await new Promise(resolve => setTimeout(resolve, 2000))
          setStatusMessage('')
        }
      } else {
        setCopilotSetInfo({
          type: 'set',
          id: copilotId!,
          name: '作业集',
          note: '这是一个作业集，包含多个关卡。执行时会自动添加 "s" 后缀。',
          autoAddS: !hasS
        })
        setStatusMessage(`识别为作业集 ID: ${copilotId}${!hasS ? '（将自动添加 s 后缀）' : ''}`)
        await new Promise(resolve => setTimeout(resolve, 1500))
        setStatusMessage('')
      }
    } catch (error) {
      setStatusMessage(`❌ 网络错误: ${(error as Error).message}`)
      await new Promise(resolve => setTimeout(resolve, 2000))
      setStatusMessage('')
    } finally {
      setIsLoadingSet(false)
    }
  }

  // 搜索悖论模拟作业
  const handleSearchParadox = async () => {
    if (!paradoxSearchName.trim()) {
      setStatusMessage('❌ 请输入干员名字')
      await new Promise(resolve => setTimeout(resolve, 2000))
      setStatusMessage('')
      return
    }
    
    setIsSearchingParadox(true)
    setStatusMessage('正在搜索作业...')
    setParadoxSearchResult(null)
    
    try {
      const { searchParadoxCopilot } = await import('../services/api')
      const result = await searchParadoxCopilot(paradoxSearchName.trim())
      
      // 适配新的响应格式：数据在 result.data 中
      const data = result.data || result
      
      if (result.success && data.copilots && data.copilots.length > 0) {
        setParadoxSearchResult(data)
        setStatusMessage(`✓ 找到 ${data.copilots.length} 个作业`)
        await new Promise(resolve => setTimeout(resolve, 1500))
        setStatusMessage('')
        
        // 自动填充推荐作业
        if (data.recommended) {
          setTaskInputs({ ...taskInputs, paradoxcopilot: data.recommended.uri })
        }
      } else {
        setStatusMessage(`❌ ${result.message || data.error || '未找到作业'}`)
        await new Promise(resolve => setTimeout(resolve, 2000))
        setStatusMessage('')
        setParadoxSearchResult(null)
      }
    } catch (error) {
      setStatusMessage(`❌ 搜索失败: ${(error as Error).message}`)
      await new Promise(resolve => setTimeout(resolve, 2000))
      setStatusMessage('')
      setParadoxSearchResult(null)
    } finally {
      setIsSearchingParadox(false)
    }
  }
  
  // 搜索普通关卡作业
  const handleSearchCopilot = async () => {
    if (!copilotSearchStage.trim()) {
      setStatusMessage('❌ 请输入关卡名称')
      await new Promise(resolve => setTimeout(resolve, 2000))
      setStatusMessage('')
      return
    }
    
    setIsSearchingCopilot(true)
    setStatusMessage('正在搜索作业...')
    setCopilotSearchResult(null)
    
    try {
      const { searchCopilot } = await import('../services/api')
      const result = await searchCopilot(copilotSearchStage.trim())
      
      // 适配新的响应格式：数据在 result.data 中
      const data = result.data || result
      
      if (result.success && data.copilots && data.copilots.length > 0) {
        setCopilotSearchResult(data)
        setStatusMessage(`✓ 找到 ${data.copilots.length} 个作业`)
        await new Promise(resolve => setTimeout(resolve, 1500))
        setStatusMessage('')
        
        // 自动填充推荐作业
        if (data.recommended) {
          setTaskInputs({ ...taskInputs, copilot: data.recommended.uri })
        }
      } else {
        setStatusMessage(`❌ ${result.message || data.error || '未找到作业'}`)
        await new Promise(resolve => setTimeout(resolve, 2000))
        setStatusMessage('')
        setCopilotSearchResult(null)
      }
    } catch (error) {
      setStatusMessage(`❌ 搜索失败: ${(error as Error).message}`)
      await new Promise(resolve => setTimeout(resolve, 2000))
      setStatusMessage('')
      setCopilotSearchResult(null)
    } finally {
      setIsSearchingCopilot(false)
    }
  }


  const renderAdvancedOptions = (task: CombatTask) => {
    const options = getAdvancedOptions(task.id)
    if (options.length === 0) return null
    
    const advanced = advancedParams[task.id] || {}
    
    return (
      <motion.div 
        className="mt-4 space-y-3 border-t border-gray-200 dark:border-white/10 pt-4"
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        transition={{ duration: 0.3 }}
      >
        {options.map(option => (
          <div key={option.key} className="flex items-center space-x-2">
            {option.type === 'checkbox' ? (
              <label className="flex items-center space-x-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={advanced[option.key] as boolean || false}
                  onChange={(e) => handleAdvancedChange(task.id, option.key, e.target.checked)}
                  className="custom-checkbox-emerald cursor-pointer"
                />
                <span className="group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">{option.label}</span>
              </label>
            ) : option.type === 'select' && option.options ? (
              <div className="flex items-center space-x-2 flex-1">
                <label className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">{option.label}:</label>
                <select
                  value={(advanced[option.key] as string) || (option.options[0]?.value || '')}
                  onChange={(e) => handleAdvancedChange(task.id, option.key, e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-white/10 hover:border-emerald-400 dark:hover:border-emerald-500/50 rounded-xl text-sm text-gray-900 dark:text-gray-200 bg-white dark:bg-[#070707] focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                >
                  {option.options.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="flex items-center space-x-2 flex-1">
                <label className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">{option.label}:</label>
                <input
                  type={option.type}
                  value={advanced[option.key] as string || ''}
                  onChange={(e) => handleAdvancedChange(task.id, option.key, e.target.value)}
                  placeholder={option.placeholder}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-white/10 hover:border-emerald-400 dark:hover:border-emerald-500/50 rounded-xl text-sm text-gray-900 dark:text-gray-200 bg-white dark:bg-[#070707] focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                />
              </div>
            )}
          </div>
        ))}
      </motion.div>
    )
  }

  return (
    <>
      <div className="p-6 space-y-6">
        <PageHeader
          icon={<Icons.TargetIcon />}
          title="自动战斗"
          subtitle="使用作业自动完成关卡 - 所有修改自动保存"
          gradientFrom="emerald-400"
          gradientVia="green-400"
          gradientTo="teal-400"
          actions={
            <StatusIndicator
              isActive={isRunning}
              message={statusMessage}
              activeText="运行中"
              inactiveText="就绪"
              activeColor="emerald-400"
            />
          }
        />

        {/* 任务列表 */}
        <div className="space-y-6">
          {/* 自动抄作业 - 单独一行 */}
          {tasks.filter(task => task.id === 'copilot').map((task) => {
            return (
              <div 
                key={task.id} 
                className="rounded-3xl p-6 border border-gray-200 dark:border-white/10 hover:border-emerald-400 dark:hover:border-emerald-500/30 transition-all bg-white dark:bg-gray-900/60"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-3">
                    {task.icon}
                    <h4 className="font-bold text-gray-900 dark:text-white text-xl">{task.name}</h4>
                    <span className="text-xs text-gray-500 dark:text-gray-500 px-3 py-1.5 rounded-full font-mono border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-gray-800/60">{task.command}</span>
                  </div>
                  
                  {/* 执行按钮 - 右上角 */}
                  <Button
                    onClick={() => handleExecute(task)}
                    disabled={isRunning}
                    variant="gradient"
                    gradientFrom="emerald-500"
                    gradientTo="teal-500"
                    size="md"
                    icon={
                      <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                      </svg>
                    }
                    className="text-xs sm:text-sm px-4 sm:px-6 py-1.5 sm:py-2.5"
                  >
                    立即执行
                  </Button>
                </div>
                
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-5 leading-relaxed">{task.description}</p>
              
                {/* 左右布局 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-5">
                  {/* 左侧：输入区域 */}
                  <div className="space-y-3">
                    {/* 关卡搜索 */}
                    <div className="rounded-2xl p-4 border border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-900/10">
                      <div className="flex items-center space-x-2 mb-3">
                        <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <h5 className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">快速搜索</h5>
                      </div>
                      <div className="flex space-x-2">
                        <input
                          type="text"
                          placeholder="输入关卡名称，如：1-7、CE-6"
                          value={copilotSearchStage}
                          onChange={(e) => setCopilotSearchStage(e.target.value)}
                          onKeyPress={(e) => e.key === 'Enter' && handleSearchCopilot()}
                          className="flex-1 px-4 py-2 border border-emerald-300 dark:border-emerald-500/30 rounded-xl text-sm text-gray-900 dark:text-gray-200 bg-white dark:bg-[#070707] focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                        />
                        <Button
                          onClick={handleSearchCopilot}
                          disabled={isSearchingCopilot || !copilotSearchStage.trim()}
                          loading={isSearchingCopilot}
                          variant="success"
                          size="md"
                          icon={
                            !isSearchingCopilot && (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                              </svg>
                            )
                          }
                          className="px-4 py-2"
                        >
                          {!isSearchingCopilot && '搜索'}
                        </Button>
                      </div>
                      
                      {/* 搜索结果 */}
                      {copilotSearchResult && copilotSearchResult.copilots && (
                        <div className="mt-3 space-y-2">
                          <div className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">
                            找到 {copilotSearchResult.stage} 的 {copilotSearchResult.copilots.length} 个作业：
                          </div>
                          <div className="space-y-1 max-h-32 overflow-y-auto">
                            {copilotSearchResult.copilots.slice(0, 5).map((copilot, idx) => {
                              // 计算星星数量（热度评分向上取整，最多5颗星）
                              const stars = Math.min(5, Math.max(1, Math.ceil(copilot.hotScore)))
                              
                              return (
                                <button
                                  key={copilot.id}
                                  onClick={() => {
                                    setTaskInputs({ ...taskInputs, copilot: copilot.uri })
                                  }}
                                  className="w-full text-left px-3 py-2 rounded-lg bg-white dark:bg-gray-800/60 border border-emerald-200 dark:border-emerald-500/20 hover:border-emerald-400 dark:hover:border-emerald-500/40 transition-all text-xs"
                                >
                                  <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center space-x-2">
                                      <span className="px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded font-mono text-xs font-medium">{copilot.stageName}</span>
                                      <span className="text-gray-900 dark:text-gray-100 font-medium">{copilot.title}</span>
                                    </div>
                                    {idx === 0 && (
                                      <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded text-xs font-medium">推荐</span>
                                    )}
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className="font-mono text-emerald-600 dark:text-emerald-400 text-xs">{copilot.uri}</span>
                                  </div>
                                  <div className="flex items-center space-x-2 text-gray-600 dark:text-gray-400 mt-1">
                                    <span>浏览 {copilot.views.toLocaleString()}</span>
                                    <span>·</span>
                                    <div className="flex items-center">
                                      {[...Array(stars)].map((_, i) => (
                                        <svg key={i} className="w-3.5 h-3.5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                        </svg>
                                      ))}
                                    </div>
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                    
                    <div className="flex flex-col space-y-3">
                      <textarea
                        placeholder={task.placeholder + '\n支持多行，每行一个作业 URI'}
                        value={taskInputs[task.id] || ''}
                        onChange={(e) => handleInputChange(task.id, e.target.value)}
                        rows={3}
                        className="flex-1 px-4 py-3 border border-gray-300 dark:border-white/10 rounded-2xl text-sm font-medium text-gray-900 dark:text-gray-200 bg-white dark:bg-[#070707] focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none font-mono transition-all"
                      />
                      <Button
                        onClick={handlePreviewCopilotSet}
                        disabled={isLoadingSet || !taskInputs[task.id]?.trim()}
                        loading={isLoadingSet}
                        variant="secondary"
                        size="md"
                        fullWidth
                        icon={
                          !isLoadingSet && (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          )
                        }
                        className="px-5 py-3"
                      >
                        {!isLoadingSet && '预览'}
                      </Button>
                    </div>
                    
                    {copilotSetInfo && (
                      <motion.div 
                        className="backdrop-blur-sm rounded-2xl p-4 border border-sky-300 dark:border-sky-500/30 bg-sky-50 dark:bg-sky-500/5"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        transition={{ duration: 0.3 }}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center space-x-2 mb-2">
                              <span className="text-xs font-semibold text-sky-700 dark:text-sky-400">
                                {copilotSetInfo.type === 'set' ? '作业集' : '单个作业'}
                              </span>
                              <span className="text-xs text-sky-600 dark:text-sky-300">ID: {copilotSetInfo.id}</span>
                            </div>
                            <p className="text-sm font-medium text-sky-800 dark:text-sky-200">{copilotSetInfo.name}</p>
                            {copilotSetInfo.type === 'set' && copilotSetInfo.note && (
                              <p className="text-xs text-sky-700 dark:text-sky-400 mt-1.5">{copilotSetInfo.note}</p>
                            )}
                            {copilotSetInfo.type === 'single' && (
                              <div className="text-xs text-sky-700 dark:text-sky-400 mt-1.5 space-y-0.5">
                                {copilotSetInfo.stage && <p>关卡: {copilotSetInfo.stage}</p>}
                                {copilotSetInfo.operators && <p>干员: {copilotSetInfo.operators}</p>}
                              </div>
                            )}
                          </div>
                          <Button
                            onClick={() => setCopilotSetInfo(null)}
                            variant="ghost"
                            size="sm"
                            className="text-sky-700 dark:text-sky-400 hover:text-sky-600 dark:hover:text-sky-300"
                          >
                            ✕
                          </Button>
                        </div>
                      </motion.div>
                    )}
                    
                    {/* 使用说明 */}
                    <div className="rounded-2xl p-4 border border-amber-300 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/5">
                      <h3 className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-2 flex items-center space-x-1.5">
                        <Icons.Lightbulb />
                        <span>使用说明</span>
                      </h3>
                      <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                        <li>• 访问 <a href="https://zoot.plus/" target="_blank" rel="noopener noreferrer" className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 hover:underline transition-colors">zoot.plus</a> 获取作业 URI</li>
                        <li>• <strong className="text-gray-800 dark:text-gray-300">单个作业</strong>：maa://1234</li>
                        <li>• <strong className="text-gray-800 dark:text-gray-300">作业集</strong>：maa://1234s</li>
                        <li>• 支持多行输入，每行一个 URI</li>
                        <li>• 点击"预览"查看作业信息</li>
                      </ul>
                    </div>
                  </div>

                  {/* 右侧：选项和高级选项 */}
                  <div className="space-y-4">
                    {/* 基础选项 */}
                    <div className="rounded-2xl p-4 border border-gray-200 dark:border-white/10 space-y-3 bg-gray-50 dark:bg-gray-800/40">
                      {/* 自动编队 */}
                      <label className="flex items-center space-x-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={autoFormation[task.id] !== false}
                          onChange={(e) => setAutoFormation({ ...autoFormation, [task.id]: e.target.checked })}
                          className="custom-checkbox-emerald cursor-pointer"
                        />
                        <span className="group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">自动编队</span>
                      </label>
                      
                      {/* 突袭模式 */}
                      <div className="flex items-center space-x-2">
                        <label className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap flex items-center space-x-1.5">
                          <Icons.Swords />
                          <span>突袭模式:</span>
                        </label>
                        <select
                          value={advancedParams[task.id]?.raid as string || '0'}
                          onChange={(e) => handleAdvancedChange(task.id, 'raid', e.target.value)}
                          className="flex-1 px-3 py-2 border border-gray-300 dark:border-white/10 hover:border-emerald-400 dark:hover:border-emerald-500/50 rounded-xl text-sm text-gray-900 dark:text-gray-200 bg-white dark:bg-[#070707] focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                        >
                          <option value="0">普通模式</option>
                          <option value="1">突袭模式</option>
                          <option value="2">两次（普通+突袭）</option>
                        </select>
                      </div>
                    </div>
                    
                    {/* 高级选项 */}
                    {task.hasAdvanced && (
                      <div className="rounded-2xl p-4 border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-gray-800/40">
                        <h5 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">高级选项</h5>
                        {renderAdvancedOptions(task)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          {/* 保全派驻和悖论模拟 - 两个卡片在一行 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {tasks.filter(task => task.id !== 'copilot').map((task) => {
              return (
                <div 
                  key={task.id} 
                  className="rounded-3xl p-6 border border-gray-200 dark:border-white/10 hover:border-emerald-400 dark:hover:border-emerald-500/30 transition-all bg-white dark:bg-gray-900/60"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-3">
                      {task.icon}
                      <h4 className="font-bold text-gray-900 dark:text-white text-xl">{task.name}</h4>
                      <span className="text-xs text-gray-500 dark:text-gray-500 px-3 py-1.5 rounded-full font-mono border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-gray-800/60">{task.command}</span>
                    </div>
                    
                    {/* 执行按钮 - 右上角 */}
                    <Button
                      onClick={() => handleExecute(task)}
                      disabled={isRunning}
                      variant="gradient"
                      gradientFrom="emerald-500"
                      gradientTo="teal-500"
                      size="md"
                      icon={
                        <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                        </svg>
                      }
                      className="text-xs sm:text-sm px-4 sm:px-5 py-1.5 sm:py-2"
                    >
                      立即执行
                    </Button>
                  </div>
                  
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-5 leading-relaxed">{task.description}</p>
                
                  {/* 左右布局 */}
                  <div className="grid grid-cols-1 gap-4 mb-5">
                    {/* 悖论模拟：干员名字搜索 */}
                    {task.id === 'paradoxcopilot' && (
                      <div className="rounded-2xl p-4 border border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-900/10">
                        <div className="flex items-center space-x-2 mb-3">
                          <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                          <h5 className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">快速搜索</h5>
                        </div>
                        <div className="flex space-x-2">
                          <input
                            type="text"
                            placeholder="输入干员名字，如：古米、能天使"
                            value={paradoxSearchName}
                            onChange={(e) => setParadoxSearchName(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleSearchParadox()}
                            className="flex-1 px-4 py-2 border border-emerald-300 dark:border-emerald-500/30 rounded-xl text-sm text-gray-900 dark:text-gray-200 bg-white dark:bg-[#070707] focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                          />
                          <Button
                            onClick={handleSearchParadox}
                            disabled={isSearchingParadox || !paradoxSearchName.trim()}
                            loading={isSearchingParadox}
                            variant="success"
                            size="md"
                            icon={
                              !isSearchingParadox && (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                              )
                            }
                            className="px-4 py-2"
                          >
                            {!isSearchingParadox && '搜索'}
                          </Button>
                        </div>
                        
                        {/* 搜索结果 */}
                        {paradoxSearchResult && paradoxSearchResult.copilots && (
                          <div className="mt-3 space-y-2">
                            <div className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">
                              找到 {paradoxSearchResult.operator} 的 {paradoxSearchResult.copilots.length} 个作业：
                            </div>
                            <div className="space-y-1 max-h-32 overflow-y-auto">
                              {paradoxSearchResult.copilots.slice(0, 5).map((copilot, idx) => {
                                // 计算星星数量（热度评分向上取整，最多5颗星）
                                const stars = Math.min(5, Math.max(1, Math.ceil(copilot.hotScore)))
                                
                                return (
                                  <button
                                    key={copilot.id}
                                    onClick={() => {
                                      setTaskInputs({ ...taskInputs, paradoxcopilot: copilot.uri })
                                    }}
                                    className="w-full text-left px-3 py-2 rounded-lg bg-white dark:bg-gray-800/60 border border-emerald-200 dark:border-emerald-500/20 hover:border-emerald-400 dark:hover:border-emerald-500/40 transition-all text-xs"
                                  >
                                    <div className="flex items-center justify-between">
                                      <span className="font-mono text-emerald-600 dark:text-emerald-400">{copilot.uri}</span>
                                      {idx === 0 && (
                                        <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded text-xs font-medium">推荐</span>
                                      )}
                                    </div>
                                    <div className="flex items-center space-x-2 text-gray-600 dark:text-gray-400 mt-1">
                                      <span>浏览 {copilot.views.toLocaleString()}</span>
                                      <span>·</span>
                                      <div className="flex items-center">
                                        {[...Array(stars)].map((_, i) => (
                                          <svg key={i} className="w-3.5 h-3.5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                          </svg>
                                        ))}
                                      </div>
                                    </div>
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* 输入区域 */}
                    <textarea
                      placeholder={task.placeholder + '\n支持多行，每行一个作业 URI'}
                      value={taskInputs[task.id] || ''}
                      onChange={(e) => handleInputChange(task.id, e.target.value)}
                      rows={2}
                      className="w-full px-4 py-3 border border-gray-300 dark:border-white/10 rounded-2xl text-sm font-medium text-gray-900 dark:text-gray-200 bg-white dark:bg-[#070707] focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none font-mono transition-all"
                    />
                    
                    {/* 选项区域 */}
                    <div className="space-y-3">
                      {/* 高级选项 */}
                      {task.hasAdvanced && (
                        <div className="rounded-2xl p-3 border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-gray-800/40">
                          <h5 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">高级选项</h5>
                          {renderAdvancedOptions(task)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}
