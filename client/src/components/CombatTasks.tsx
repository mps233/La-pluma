import { useState, useEffect } from 'react'
import { maaApi } from '../services/api'
import { motion } from 'framer-motion'
import Icons from './Icons'
import { PageHeader, Button } from './common'
import { useStatusStore } from '../store/statusStore'
import FloatingStatusIndicator from './FloatingStatusIndicator'
import type {
  CombatTasksProps,
  CombatTask,
  CombatAdvancedOption,
  CombatTaskInputs,
  CombatAdvancedParams,
  AutoFormationConfig,
  CopilotSetInfo,
  CopilotSearchResult,
  ParadoxSearchResult,
  CopilotSetItem
} from '@/types/components'

// CopilotType 已移除

export default function CombatTasks(_props: CombatTasksProps) {
  const [isRunning, setIsRunning] = useState(false)
  const { setMessage: setStatusMessage, setActive: setIsActiveStatus } = useStatusStore()
  const [taskInputs, setTaskInputs] = useState<CombatTaskInputs>({})
  const [copilotSetInfo, setCopilotSetInfo] = useState<CopilotSetInfo | null>(null)
  const [isLoadingSet, setIsLoadingSet] = useState(false)
  const [advancedParams, setAdvancedParams] = useState<CombatAdvancedParams>({
    copilot: { ignoreRequirements: true }
  })
  const [autoFormation, setAutoFormation] = useState<AutoFormationConfig>({ copilot: true, paradoxcopilot: true })

  // 作业类型选择：'auto' 自动检测，'single' 单个作业，'set' 作业集
  const [copilotType, setCopilotType] = useState<'auto' | 'single' | 'set'>('auto')

  // 作业集执行控制
  const [waitingForNextCopilot, setWaitingForNextCopilot] = useState(false)
  const [currentCopilotTask, setCurrentCopilotTask] = useState<CombatTask | null>(null)
  const [copilotSetResults, setCopilotSetResults] = useState<{ index: number; success: boolean; error?: string }[]>([])

  // 作业集任务选择状态（记录选中的索引）
  const [selectedCopilotIndexes, setSelectedCopilotIndexes] = useState<Set<number>>(new Set())

  // 悖论模拟搜索相关状态
  const [paradoxSearchName, setParadoxSearchName] = useState('')
  const [paradoxSearchResult, setParadoxSearchResult] = useState<ParadoxSearchResult | null>(null)
  const [isSearchingParadox, setIsSearchingParadox] = useState(false)

  // 同步 isRunning 状态到 store
  useEffect(() => {
    setIsActiveStatus(isRunning)
  }, [isRunning, setIsActiveStatus])

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
                  setStatusMessage('任务已完成')
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

    // 先处理突袭模式 - 修复：确保正确读取 raid 参数
    const raidValue = advanced.raid as string | undefined
    if (task.id === 'copilot' && raidValue && raidValue !== '0') {
      params += ` --raid ${raidValue}`
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

  // 执行单个作业（等待完成）
  const executeSingleCopilot = async (task: CombatTask, params: string): Promise<{ success: boolean; error?: string }> => {
    // waitForCompletion: true 表示等待命令执行完成后再返回
    const result = await maaApi.executePredefinedTask(task.command, params, null, null, task.name, 'combat', true)
    return result
  }

  // 构建作业参数
  const buildCopilotParams = (copilotId: number, task: CombatTask): string => {
    let params = `maa://${copilotId}`

    // 添加自动编队
    if (autoFormation[task.id]) {
      params += ' --formation'
    }

    // 添加高级参数
    const advanced = advancedParams[task.id] || {}

    // 突袭模式 - 修复：确保正确读取 raid 参数
    const raidValue = advanced.raid as string | undefined
    if (raidValue && raidValue !== '0') {
      params += ` --raid ${raidValue}`
    }

    // 其他高级选项
    const options = getAdvancedOptions(task.id)
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

  // 执行作业集中的单个作业
  const executeCopilotAtIndex = async (task: CombatTask, index: number): Promise<{ success: boolean; error?: string }> => {
    if (!copilotSetInfo?.copilots || !copilotSetInfo.copilots[index]) {
      return { success: false, error: '作业不存在' }
    }

    const copilot = copilotSetInfo.copilots[index]
    if (!copilot) {
      return { success: false, error: '作业不存在' }
    }

    // 更新当前执行索引
    setCopilotSetInfo(prev => prev ? { ...prev, currentIndex: index } : null)
    setStatusMessage(`正在执行作业 ${index + 1}/${copilotSetInfo.copilots.length}: ${copilot.name || `maa://${copilot.id}`}`)

    const params = buildCopilotParams(copilot.id, task)

    try {
      const result = await executeSingleCopilot(task, params)
      return result
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }

  // 开始执行作业集（执行第一个选中的作业）
  const startCopilotSet = async (task: CombatTask) => {
    if (!copilotSetInfo?.copilots || copilotSetInfo.copilots.length === 0) {
      setStatusMessage('作业集为空')
      return
    }

    // 找到第一个选中的作业
    const firstSelectedIndex = copilotSetInfo.copilots.findIndex((_, idx) => selectedCopilotIndexes.has(idx))
    if (firstSelectedIndex === -1) {
      setStatusMessage('请至少选择一个作业')
      return
    }

    setIsRunning(true)
    setCopilotSetResults([])
    setCurrentCopilotTask(task)

    const result = await executeCopilotAtIndex(task, firstSelectedIndex)
    setCopilotSetResults([{ index: firstSelectedIndex, success: result.success, error: result.error }])

    // 计算剩余选中的作业数量
    const remainingSelected = copilotSetInfo.copilots.filter((_, idx) => selectedCopilotIndexes.has(idx) && idx !== firstSelectedIndex).length

    if (result.success) {
      if (remainingSelected > 0) {
        setStatusMessage(`作业 ${firstSelectedIndex + 1}/${copilotSetInfo.copilots.length} 完成，等待开始下一关`)
        setWaitingForNextCopilot(true)
      } else {
        const selectedCount = selectedCopilotIndexes.size
        setStatusMessage(`作业集执行完成 (${selectedCount} 个作业)`)
        finishCopilotSet()
      }
    } else {
      if (remainingSelected > 0) {
        setStatusMessage(`作业 ${firstSelectedIndex + 1} 执行失败: ${result.error}，等待开始下一关`)
        setWaitingForNextCopilot(true)
      } else {
        setStatusMessage(`作业执行失败: ${result.error}`)
        finishCopilotSet()
      }
    }
  }

  // 执行下一个作业
  const handleStartNextCopilot = async () => {
    if (!copilotSetInfo?.copilots || !currentCopilotTask) return

    // 找到下一个选中且未完成的作业
    const nextIndex = copilotSetInfo.copilots.findIndex((_, idx) =>
      selectedCopilotIndexes.has(idx) && !copilotSetResults.some(r => r.index === idx)
    )

    if (nextIndex === -1) {
      // 所有选中的作业已完成
      const selectedCount = selectedCopilotIndexes.size
      const successCount = copilotSetResults.filter(r => r.success).length
      setStatusMessage(`作业集执行完成 (${successCount}/${selectedCount} 成功)`)
      finishCopilotSet()
      return
    }

    setWaitingForNextCopilot(false)
    setIsRunning(true)

    const result = await executeCopilotAtIndex(currentCopilotTask, nextIndex)
    setCopilotSetResults(prev => [...prev, { index: nextIndex, success: result.success, error: result.error }])

    // 计算剩余选中的作业数量
    const remainingSelected = copilotSetInfo.copilots.filter((_, idx) =>
      selectedCopilotIndexes.has(idx) && !copilotSetResults.some(r => r.index === idx) && idx !== nextIndex
    ).length

    if (result.success) {
      if (remainingSelected > 0) {
        setStatusMessage(`作业 ${nextIndex + 1}/${copilotSetInfo.copilots.length} 完成，等待开始下一关`)
        setWaitingForNextCopilot(true)
      } else {
        const selectedCount = selectedCopilotIndexes.size
        setStatusMessage(`作业集全部执行完成 (${selectedCount} 个作业)`)
        finishCopilotSet()
      }
    } else {
      if (remainingSelected > 0) {
        setStatusMessage(`作业 ${nextIndex + 1} 执行失败: ${result.error}，等待开始下一关`)
        setWaitingForNextCopilot(true)
      } else {
        setStatusMessage(`作业 ${nextIndex + 1} 执行失败: ${result.error}`)
        finishCopilotSet()
      }
    }
  }

  // 完成作业集执行
  const finishCopilotSet = () => {
    setTimeout(() => {
      setIsRunning(false)
      setWaitingForNextCopilot(false)
      setCurrentCopilotTask(null)
      setCopilotSetInfo(prev => prev ? { ...prev, currentIndex: 0 } : null)
    }, 1000)
  }

  // 取消作业集执行
  const handleCancelCopilotSet = () => {
    const successCount = copilotSetResults.filter(r => r.success).length
    const failCount = copilotSetResults.length - successCount

    if (successCount === 0) {
      setStatusMessage('作业集已取消，所有作业执行失败')
    } else {
      setStatusMessage(`作业集已取消: ${successCount} 个成功，${failCount} 个失败`)
    }

    finishCopilotSet()
  }

  const handleExecute = async (task: CombatTask) => {
    // 验证输入
    const inputValue = taskInputs[task.id] || ''
    if (task.id === 'copilot' || task.id === 'paradoxcopilot' || task.id === 'ssscopilot') {
      // copilot 任务需要输入作业 URI
      if (!inputValue.trim()) {
        setStatusMessage('请输入作业链接')
        setTimeout(() => setStatusMessage(''), 2000)
        return
      }
    }

    // 检查是否是作业集模式
    if (task.id === 'copilot' && copilotSetInfo?.type === 'set' && copilotSetInfo.copilots && copilotSetInfo.copilots.length > 0) {
      // 作业集模式：开始执行第一个作业
      await startCopilotSet(task)
    } else {
      // 单个作业模式
      setIsRunning(true)
      setStatusMessage(`正在执行: ${task.name}`)

      try {
        const params = buildCommandParams(task)
        const result = await maaApi.executePredefinedTask(task.command, params, null, null, task.name, 'combat')

        if (result.success) {
          setStatusMessage(`${task.name} 执行成功`)
          await new Promise(resolve => setTimeout(resolve, 2000))
          setStatusMessage('')
        } else {
          setStatusMessage(`执行失败: ${result.error}`)
          await new Promise(resolve => setTimeout(resolve, 2000))
          setStatusMessage('')
        }
      } catch (error) {
        setStatusMessage(`网络错误: ${(error as Error).message}`)
        await new Promise(resolve => setTimeout(resolve, 2000))
        setStatusMessage('')
      } finally {
        setTimeout(() => {
          setIsRunning(false)
        }, 1000)
      }
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

  // 从作业内容中提取干员列表（包含固定干员和干员组）
  const extractOperators = (content: any): string => {
    const opers = content.opers?.map((op: any) => op.name) || []
    const groups = content.groups?.map((g: any) => `[${g.name}]`) || []
    const allOpers = [...opers, ...groups]
    return allOpers.length > 0 ? allOpers.join('、') : '未知'
  }

  // 获取单个作业详情
  const fetchCopilotDetail = async (copilotId: number): Promise<CopilotSetItem | null> => {
    try {
      const response = await fetch(`https://prts.maa.plus/copilot/get/${copilotId}`)
      if (response.ok) {
        const data = await response.json()
        if (data.status_code === 200 && data.data) {
          const content = JSON.parse(data.data.content)
          return {
            id: copilotId,
            name: content.doc?.title || '未命名作业',
            stage: content.stage_name,
            operators: extractOperators(content),
            uri: `maa://${copilotId}`
          }
        }
      }
    } catch {
      // 忽略单个作业获取失败
    }
    return { id: copilotId, uri: `maa://${copilotId}` }
  }

  // 获取作业集详情（包含所有作业列表）
  const fetchCopilotSetDetails = async (setId: string): Promise<CopilotSetItem[]> => {
    try {
      const response = await fetch(`https://prts.maa.plus/set/get?id=${setId}`)
      if (response.ok) {
        const data = await response.json()
        if (data.status_code === 200 && data.data?.copilot_ids) {
          const copilotIds: number[] = data.data.copilot_ids
          // 并行获取所有作业详情
          const details = await Promise.all(copilotIds.map(id => fetchCopilotDetail(id)))
          return details.filter((item): item is CopilotSetItem => item !== null)
        }
      }
    } catch {
      // 忽略错误
    }
    return []
  }

  const handlePreviewCopilotSet = async () => {
    const input = taskInputs['copilot'] || ''
    const match = input.trim().match(/^maa:\/\/(\d+)(s?)$/)

    if (!match) {
      setStatusMessage('请输入有效的作业 URI（如: maa://26766）')
      await new Promise(resolve => setTimeout(resolve, 2000))
      setStatusMessage('')
      return
    }

    const copilotId = match[1] || ''
    const hasS = match[2] === 's'
    setIsLoadingSet(true)
    setStatusMessage('正在获取作业信息...')

    try {
      // 根据用户选择或自动检测模式
      if (copilotType === 'single') {
        // 强制单个作业模式
        const copilotResponse = await fetch(`https://prts.maa.plus/copilot/get/${copilotId}`)
        if (copilotResponse.ok) {
          const copilotData = await copilotResponse.json()
          if (copilotData.status_code === 200 && copilotData.data) {
            const content = JSON.parse(copilotData.data.content)
            setCopilotSetInfo({
              type: 'single',
              id: copilotId,
              name: content.doc?.title || '未命名作业',
              stage: content.stage_name,
              operators: extractOperators(content)
            })
            setStatusMessage(`找到作业：${content.doc?.title || content.stage_name}`)
          } else {
            setStatusMessage('作业不存在')
          }
        } else {
          setStatusMessage('无法获取作业信息')
        }
      } else if (copilotType === 'set') {
        // 强制作业集模式
        const copilots = await fetchCopilotSetDetails(copilotId)
        if (copilots.length > 0) {
          setCopilotSetInfo({
            type: 'set',
            id: copilotId,
            name: `作业集 (${copilots.length} 个作业)`,
            note: '包含多个关卡，将按顺序执行',
            autoAddS: !hasS,
            copilots,
            currentIndex: 0
          })
          // 默认选中所有作业
          setSelectedCopilotIndexes(new Set(copilots.map((_, idx) => idx)))
          setStatusMessage(`找到作业集，包含 ${copilots.length} 个作业`)
        } else {
          setStatusMessage('作业集不存在或为空')
        }
      } else {
        // 自动检测模式：同时请求两个接口，哪个成功就用哪个
        const [copilotResult, setResult] = await Promise.allSettled([
          fetch(`https://prts.maa.plus/copilot/get/${copilotId}`).then(r => r.json()),
          fetch(`https://prts.maa.plus/set/get?id=${copilotId}`).then(r => r.json())
        ])

        let foundSingle = false
        let foundSet = false
        let singleData = null
        let setData = null

        // 检查单个作业
        if (copilotResult.status === 'fulfilled' && copilotResult.value.status_code === 200 && copilotResult.value.data) {
          foundSingle = true
          singleData = copilotResult.value
        }

        // 检查作业集
        if (setResult.status === 'fulfilled' && setResult.value.status_code === 200 && setResult.value.data?.copilot_ids) {
          foundSet = true
          setData = setResult.value
        }

        // 根据结果决定使用哪个
        if (foundSingle && foundSet) {
          // 两个都存在，优先使用作业集（因为作业集更少见，用户可能更想要）
          const copilotIds: number[] = setData.data.copilot_ids
          const copilots = await Promise.all(copilotIds.map(id => fetchCopilotDetail(id)))
          const validCopilots = copilots.filter((item): item is CopilotSetItem => item !== null)
          setCopilotSetInfo({
            type: 'set',
            id: copilotId,
            name: `作业集 (${validCopilots.length} 个作业)`,
            note: '包含多个关卡，将按顺序执行',
            autoAddS: !hasS,
            copilots: validCopilots,
            currentIndex: 0
          })
          // 默认选中所有作业
          setSelectedCopilotIndexes(new Set(validCopilots.map((_, idx) => idx)))
          setStatusMessage(`识别为作业集，包含 ${validCopilots.length} 个作业`)
        } else if (foundSet) {
          // 只有作业集
          const copilotIds: number[] = setData.data.copilot_ids
          const copilots = await Promise.all(copilotIds.map(id => fetchCopilotDetail(id)))
          const validCopilots = copilots.filter((item): item is CopilotSetItem => item !== null)
          setCopilotSetInfo({
            type: 'set',
            id: copilotId,
            name: `作业集 (${validCopilots.length} 个作业)`,
            note: '包含多个关卡，将按顺序执行',
            autoAddS: !hasS,
            copilots: validCopilots,
            currentIndex: 0
          })
          // 默认选中所有作业
          setSelectedCopilotIndexes(new Set(validCopilots.map((_, idx) => idx)))
          setStatusMessage(`找到作业集，包含 ${validCopilots.length} 个作业`)
        } else if (foundSingle) {
          // 只有单个作业
          const content = JSON.parse(singleData.data.content)
          setCopilotSetInfo({
            type: 'single',
            id: copilotId,
            name: content.doc?.title || '未命名作业',
            stage: content.stage_name,
            operators: extractOperators(content)
          })
          setStatusMessage(`找到作业：${content.doc?.title || content.stage_name}`)
        } else {
          setStatusMessage('未找到作业或作业集')
        }
      }

      await new Promise(resolve => setTimeout(resolve, 1500))
      setStatusMessage('')
    } catch (error) {
      setStatusMessage(`网络错误: ${(error as Error).message}`)
      await new Promise(resolve => setTimeout(resolve, 2000))
      setStatusMessage('')
    } finally {
      setIsLoadingSet(false)
    }
  }

  // 搜索悖论模拟作业
  const handleSearchParadox = async () => {
    if (!paradoxSearchName.trim()) {
      setStatusMessage('请输入干员名字')
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
        setStatusMessage(`找到 ${data.copilots.length} 个作业`)
        await new Promise(resolve => setTimeout(resolve, 1500))
        setStatusMessage('')

        // 自动填充推荐作业
        if (data.recommended) {
          setTaskInputs({ ...taskInputs, paradoxcopilot: data.recommended.uri })
        }
      } else {
        setStatusMessage(result.message || data.error || '未找到作业')
        await new Promise(resolve => setTimeout(resolve, 2000))
        setStatusMessage('')
        setParadoxSearchResult(null)
      }
    } catch (error) {
      setStatusMessage(`搜索失败: ${(error as Error).message}`)
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
      setStatusMessage('请输入关卡名称')
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
        setStatusMessage(`找到 ${data.copilots.length} 个作业`)
        await new Promise(resolve => setTimeout(resolve, 1500))
        setStatusMessage('')

        // 自动填充推荐作业
        if (data.recommended) {
          setTaskInputs({ ...taskInputs, copilot: data.recommended.uri })
        }
      } else {
        setStatusMessage(result.message || data.error || '未找到作业')
        await new Promise(resolve => setTimeout(resolve, 2000))
        setStatusMessage('')
        setCopilotSearchResult(null)
      }
    } catch (error) {
      setStatusMessage(`搜索失败: ${(error as Error).message}`)
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
                  className="custom-checkbox-teal cursor-pointer"
                />
                <span className="group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors">{option.label}</span>
              </label>
            ) : option.type === 'select' && option.options ? (
              <div className="flex items-center space-x-2 flex-1">
                <label className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">{option.label}:</label>
                <select
                  value={(advanced[option.key] as string) || (option.options[0]?.value || '')}
                  onChange={(e) => handleAdvancedChange(task.id, option.key, e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-white/10 hover:border-teal-400 dark:hover:border-teal-500/50 rounded-xl text-sm text-gray-900 dark:text-gray-200 bg-white dark:bg-[#070707] focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all"
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
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-white/10 hover:border-teal-400 dark:hover:border-teal-500/50 rounded-xl text-sm text-gray-900 dark:text-gray-200 bg-white dark:bg-[#070707] focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all"
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
          gradientFrom="teal-400"
          gradientVia="cyan-400"
          gradientTo="blue-400"
          actions={<FloatingStatusIndicator />}
        />

        {/* 任务列表 */}
        <div className="space-y-6">
          {/* 自动抄作业 - 单独一行 */}
          {tasks.filter(task => task.id === 'copilot').map((task) => {
            return (
              <div
                key={task.id}
                className="rounded-3xl p-6 border border-gray-200 dark:border-white/10 hover:border-teal-400 dark:hover:border-teal-500/30 transition-all bg-white dark:bg-gray-900/60 hover:shadow-lg"
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
                    disabled={isRunning && !waitingForNextCopilot}
                    variant="gradient"
                    gradientFrom="teal"
                    gradientTo="cyan"
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

                {/* 三栏布局 */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* 左栏：设置项 */}
                  <div className="space-y-3">
                    <div className="rounded-2xl p-4 border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-gray-800/40">
                      <h5 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center space-x-2">
                        <svg className="w-4 h-4 text-teal-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <span>执行设置</span>
                      </h5>

                      {/* 自动编队 */}
                      <label className="flex items-center space-x-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer mb-3">
                        <input
                          type="checkbox"
                          checked={autoFormation[task.id] !== false}
                          onChange={(e) => setAutoFormation({ ...autoFormation, [task.id]: e.target.checked })}
                          className="custom-checkbox-teal cursor-pointer"
                        />
                        <span>自动编队</span>
                      </label>

                      {/* 突袭模式 */}
                      <div className="flex items-center space-x-2 mb-3">
                        <label className="text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">模式:</label>
                        <select
                          value={advancedParams[task.id]?.raid as string || '0'}
                          onChange={(e) => handleAdvancedChange(task.id, 'raid', e.target.value)}
                          className="flex-1 px-2 py-1.5 border border-gray-300 dark:border-white/10 rounded-lg text-xs text-gray-900 dark:text-gray-200 bg-white dark:bg-[#070707] focus:outline-none focus:ring-1 focus:ring-teal-500"
                        >
                          <option value="0">普通模式</option>
                          <option value="1">突袭模式</option>
                          <option value="2">普通+突袭</option>
                        </select>
                      </div>

                      {/* 高级选项 - 直接显示 */}
                      {task.hasAdvanced && renderAdvancedOptions(task)}
                    </div>

                    {/* 使用说明 - 直接显示 */}
                    <div className="rounded-2xl p-4 border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-gray-800/40">
                      <h5 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">使用说明</h5>
                      <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                        <p>• 访问 <a href="https://zoot.plus/" target="_blank" rel="noopener noreferrer" className="text-teal-600 dark:text-teal-400 hover:underline">zoot.plus</a> 获取作业 URI</p>
                        <p>• 单个作业：<code className="px-1 bg-gray-100 dark:bg-gray-800 rounded">maa://1234</code></p>
                        <p>• 作业集：<code className="px-1 bg-gray-100 dark:bg-gray-800 rounded">maa://1234s</code></p>
                      </div>
                    </div>
                  </div>

                  {/* 中栏：输入框 + 作业列表 */}
                  <div className="space-y-3 flex flex-col">
                    {/* URI输入框 - 无卡片包裹 */}
                    <div className="flex space-x-2">
                      <input
                        type="text"
                        placeholder="粘贴作业 URI，如 maa://1234 或 maa://1234s"
                        value={taskInputs[task.id] || ''}
                        onChange={(e) => handleInputChange(task.id, e.target.value)}
                        className="flex-1 px-3 py-2 border border-gray-300 dark:border-white/10 rounded-xl text-sm font-mono text-gray-900 dark:text-gray-200 bg-white dark:bg-[#070707] focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all"
                      />
                      <Button
                        onClick={handlePreviewCopilotSet}
                        disabled={isLoadingSet || !taskInputs[task.id]?.trim()}
                        loading={isLoadingSet}
                        variant="secondary"
                        size="md"
                        className="px-3 self-stretch"
                        icon={
                          !isLoadingSet && (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          )
                        }
                      >
                        {!isLoadingSet && '预览'}
                      </Button>
                    </div>

                    {/* 作业类型选择 */}
                    <div className="flex items-center space-x-2 text-xs">
                      <span className="text-gray-500 dark:text-gray-400">类型:</span>
                      <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-white/10">
                        <button
                          onClick={() => setCopilotType('auto')}
                          className={`px-3 py-1 transition-colors ${
                            copilotType === 'auto'
                              ? 'bg-teal-500 text-white'
                              : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                          }`}
                        >
                          自动
                        </button>
                        <button
                          onClick={() => setCopilotType('single')}
                          className={`px-3 py-1 transition-colors border-l border-gray-200 dark:border-white/10 ${
                            copilotType === 'single'
                              ? 'bg-teal-500 text-white'
                              : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                          }`}
                        >
                          单个作业
                        </button>
                        <button
                          onClick={() => setCopilotType('set')}
                          className={`px-3 py-1 transition-colors border-l border-gray-200 dark:border-white/10 ${
                            copilotType === 'set'
                              ? 'bg-teal-500 text-white'
                              : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                          }`}
                        >
                          作业集
                        </button>
                      </div>
                    </div>

                    {/* 作业列表 - 占据剩余空间 */}
                    <div className="rounded-2xl p-4 border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-gray-800/40 flex-1 flex flex-col">
                      <div className="flex items-center justify-between mb-3">
                        <h5 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center space-x-2">
                          <svg className="w-4 h-4 text-teal-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                          </svg>
                          <span>作业列表</span>
                        </h5>
                        {/* 全选/取消全选按钮 */}
                        {copilotSetInfo?.type === 'set' && copilotSetInfo.copilots && !isRunning && (
                          <button
                            onClick={() => {
                              if (selectedCopilotIndexes.size === copilotSetInfo.copilots!.length) {
                                setSelectedCopilotIndexes(new Set())
                              } else {
                                setSelectedCopilotIndexes(new Set(copilotSetInfo.copilots!.map((_, idx) => idx)))
                              }
                            }}
                            className="text-xs text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 transition-colors"
                          >
                            {selectedCopilotIndexes.size === copilotSetInfo.copilots.length ? '取消全选' : '全选'}
                          </button>
                        )}
                      </div>

                      {/* 作业集预览 */}
                      {copilotSetInfo?.type === 'set' && copilotSetInfo.copilots && copilotSetInfo.copilots.length > 0 ? (
                        <>
                          {/* 进度条 */}
                          <div className="mb-3">
                            <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
                              <span>已选 {selectedCopilotIndexes.size} / {copilotSetInfo.copilots.length} 个作业</span>
                              <span>{copilotSetResults.filter(r => r.success && selectedCopilotIndexes.has(r.index)).length} / {selectedCopilotIndexes.size} 完成</span>
                            </div>
                            <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-teal-400 to-cyan-400 transition-all duration-300"
                                style={{ width: `${selectedCopilotIndexes.size > 0 ? (copilotSetResults.filter(r => r.success && selectedCopilotIndexes.has(r.index)).length / selectedCopilotIndexes.size) * 100 : 0}%` }}
                              />
                            </div>
                          </div>

                          {/* 当前作业卡片 */}
                          {(() => {
                            const currentCopilot = copilotSetInfo.currentIndex !== undefined
                              ? copilotSetInfo.copilots[copilotSetInfo.currentIndex]
                              : null
                            return waitingForNextCopilot && currentCopilot && (
                              <div className="mb-3 p-3 rounded-xl border-2 border-teal-400 dark:border-teal-500 bg-teal-50 dark:bg-teal-900/20">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center space-x-2">
                                    <span className="px-2 py-0.5 bg-teal-500 text-white text-xs font-medium rounded">下一关</span>
                                    <span className="text-xs text-teal-600 dark:text-teal-400">第 {(copilotSetInfo.currentIndex ?? 0) + 1} / {copilotSetInfo.copilots.length} 关</span>
                                  </div>
                                  <span className="font-mono text-xs text-teal-600 dark:text-teal-400">maa://{currentCopilot.id}</span>
                                </div>
                                <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">{currentCopilot.name || `作业 #${currentCopilot.id}`}</p>
                                {currentCopilot.stage && <p className="text-xs text-gray-500 dark:text-gray-400">{currentCopilot.stage}</p>}

                                <div className="mt-3 pt-3 border-t border-teal-200 dark:border-teal-500/20">
                                  <p className="text-xs text-teal-700 dark:text-teal-400 mb-2">请在游戏中进入下一关界面后点击继续</p>
                                  <div className="flex space-x-2">
                                    <Button onClick={handleStartNextCopilot} variant="gradient" gradientFrom="teal" gradientTo="cyan" size="md" fullWidth>
                                      开始下一关
                                    </Button>
                                    <Button onClick={handleCancelCopilotSet} variant="secondary" size="md">取消</Button>
                                  </div>
                                </div>
                              </div>
                            )
                          })()}

                          {/* 作业列表 */}
                          <div className="space-y-1 flex-1 overflow-y-auto">
                            {copilotSetInfo.copilots.map((copilot, idx) => {
                              const isCompleted = copilotSetResults.some(r => r.index === idx)
                              const isSuccess = copilotSetResults.find(r => r.index === idx)?.success
                              const isCurrent = copilotSetInfo.currentIndex === idx && isRunning
                              const isSelected = selectedCopilotIndexes.has(idx)

                              const handleToggleSelect = () => {
                                const newSet = new Set(selectedCopilotIndexes)
                                if (newSet.has(idx)) {
                                  newSet.delete(idx)
                                } else {
                                  newSet.add(idx)
                                }
                                setSelectedCopilotIndexes(newSet)
                              }

                              return (
                                <div key={copilot.id} className={`flex items-center justify-between px-2 py-1.5 rounded text-xs ${
                                  isCurrent ? 'bg-teal-100 dark:bg-teal-900/30' :
                                  isCompleted ? (isSuccess ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20') :
                                  !isSelected ? 'bg-gray-100 dark:bg-gray-800/30 opacity-60' :
                                  'bg-white dark:bg-gray-800/60'
                                }`}>
                                  <div className="flex items-center space-x-2">
                                    {/* 勾选框 */}
                                    <button
                                      onClick={handleToggleSelect}
                                      disabled={isRunning || isCompleted}
                                      className={`w-4 h-4 rounded flex items-center justify-center border transition-all ${
                                        isSelected
                                          ? 'bg-teal-500 border-teal-500 text-white'
                                          : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700'
                                      } ${isRunning || isCompleted ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-teal-400'}`}
                                    >
                                      {isSelected && (
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                        </svg>
                                      )}
                                    </button>
                                    <span className={`w-4 h-4 rounded-full flex items-center justify-center text-xs ${
                                      isCurrent ? 'bg-teal-500 text-white animate-pulse' :
                                      isCompleted ? (isSuccess ? 'bg-green-500 text-white' : 'bg-red-500 text-white') :
                                      'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                                    }`}>
                                      {isCompleted ? (isSuccess ? '✓' : '✗') : idx + 1}
                                    </span>
                                    <span className="text-gray-900 dark:text-gray-100">{copilot.name || `作业 #${copilot.id}`}</span>
                                  </div>
                                  <span className="font-mono text-gray-500 dark:text-gray-400">maa://{copilot.id}</span>
                                </div>
                              )
                            })}
                          </div>
                        </>
                      ) : copilotSetInfo?.type === 'single' ? (
                        <div className="p-3 rounded-xl bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-white/10 flex-1">
                          <div className="flex items-center space-x-2 mb-1">
                            <span className="px-2 py-0.5 bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 rounded text-xs font-medium">单个作业</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">ID: {copilotSetInfo.id}</span>
                          </div>
                          <p className="font-medium text-gray-900 dark:text-gray-100">{copilotSetInfo.name}</p>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 space-x-2">
                            {copilotSetInfo.stage && <span>关卡: {copilotSetInfo.stage}</span>}
                            {copilotSetInfo.operators && <span>干员: {copilotSetInfo.operators}</span>}
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-xs flex-1 flex flex-col items-center justify-center">
                          <svg className="w-12 h-12 mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <p>输入作业 URI 后点击预览</p>
                          <p className="mt-1">查看作业详情</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 右栏：搜索框 + 作业介绍 */}
                  <div className="space-y-3">
                    {/* 搜索框 */}
                    <div className="rounded-2xl p-4 border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-gray-800/40">
                      <h5 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center space-x-2">
                        <svg className="w-4 h-4 text-teal-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <span>快速搜索</span>
                      </h5>
                      <div className="flex space-x-2">
                        <input
                          type="text"
                          placeholder="关卡名称，如：1-7、CE-6"
                          value={copilotSearchStage}
                          onChange={(e) => setCopilotSearchStage(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSearchCopilot()}
                          className="flex-1 px-3 py-2 border border-gray-300 dark:border-white/10 rounded-xl text-sm text-gray-900 dark:text-gray-200 bg-white dark:bg-[#070707] focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all"
                        />
                        <Button
                          onClick={handleSearchCopilot}
                          disabled={isSearchingCopilot || !copilotSearchStage.trim()}
                          loading={isSearchingCopilot}
                          variant="secondary"
                          size="md"
                          className="px-3"
                        >
                          {!isSearchingCopilot && '搜索'}
                        </Button>
                      </div>

                      {/* 搜索结果 */}
                      {copilotSearchResult && copilotSearchResult.copilots && (
                        <div className="mt-3 space-y-1 max-h-32 overflow-y-auto">
                          {copilotSearchResult.copilots.slice(0, 5).map((copilot, idx) => (
                            <button
                              key={copilot.id}
                              onClick={() => setTaskInputs({ ...taskInputs, copilot: copilot.uri })}
                              className="w-full text-left px-3 py-1.5 rounded-lg bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-white/10 hover:border-teal-400 transition-all text-xs flex items-center justify-between"
                            >
                              <div className="flex items-center space-x-2">
                                <span className="font-mono text-teal-600 dark:text-teal-400">{copilot.uri}</span>
                                <span className="text-gray-600 dark:text-gray-400 truncate max-w-[80px]">{copilot.title}</span>
                              </div>
                              {idx === 0 && (
                                <span className="px-1.5 py-0.5 bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 rounded text-xs whitespace-nowrap">推荐</span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 作业介绍 */}
                    <div className="rounded-2xl p-4 border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-gray-800/40">
                      <h5 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center space-x-2">
                        <svg className="w-4 h-4 text-teal-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>作业信息</span>
                      </h5>

                      {copilotSetInfo ? (
                        <div className="space-y-2">
                          {copilotSetInfo.type === 'set' && copilotSetInfo.copilots ? (
                            (() => {
                              // 作业集模式：显示当前作业或第一个作业的详细信息
                              const currentIndex = copilotSetInfo.currentIndex ?? 0
                              const currentCopilot = copilotSetInfo.copilots[currentIndex] || copilotSetInfo.copilots[0]
                              const total = copilotSetInfo.copilots.length
                              const selectedCount = selectedCopilotIndexes.size
                              const completed = copilotSetResults.filter(r => r.success && selectedCopilotIndexes.has(r.index)).length

                              return (
                                <>
                                  <div className="flex items-center space-x-2">
                                    <span className="px-2 py-0.5 bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 rounded text-xs font-medium">作业集</span>
                                    <span className="text-xs text-gray-500 dark:text-gray-400">已选 {selectedCount}/{total} 个</span>
                                  </div>

                                  {/* 当前进度 */}
                                  <div className="flex items-center space-x-2 text-xs">
                                    <span className="text-gray-500 dark:text-gray-400">进度:</span>
                                    <span className="font-medium text-teal-600 dark:text-teal-400">
                                      {isRunning ? `第 ${currentIndex + 1} 关` : `${completed}/${selectedCount} 完成`}
                                    </span>
                                  </div>

                                  {/* 当前作业详情 */}
                                  {currentCopilot && (
                                    <div className="p-2 rounded-lg bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-white/10">
                                      <div className="flex items-center justify-between mb-1">
                                        <span className="text-xs text-gray-500 dark:text-gray-400">
                                          {isRunning ? '当前作业' : '下一作业'}
                                        </span>
                                        <span className="font-mono text-xs text-teal-600 dark:text-teal-400">
                                          maa://{currentCopilot.id}
                                        </span>
                                      </div>
                                      <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                                        {currentCopilot.name || `作业 #${currentCopilot.id}`}
                                      </p>
                                      {currentCopilot.stage && (
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                          <span className="font-medium">关卡:</span> {currentCopilot.stage}
                                        </div>
                                      )}
                                      {currentCopilot.operators && (
                                        <div className="text-xs text-gray-500 dark:text-gray-400">
                                          <span className="font-medium">干员:</span> {currentCopilot.operators}
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {copilotSetInfo.note && (
                                    <p className="text-xs text-gray-500 dark:text-gray-400">{copilotSetInfo.note}</p>
                                  )}
                                </>
                              )
                            })()
                          ) : (
                            <>
                              <div className="flex items-center space-x-2">
                                <span className="px-2 py-0.5 bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 rounded text-xs font-medium">单个作业</span>
                                <span className="text-xs text-gray-500 dark:text-gray-400">ID: {copilotSetInfo.id}</span>
                              </div>
                              <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">{copilotSetInfo.name}</p>
                              {copilotSetInfo.stage && (
                                <div className="text-xs text-gray-500 dark:text-gray-400">
                                  <span className="font-medium">关卡:</span> {copilotSetInfo.stage}
                                </div>
                              )}
                              {copilotSetInfo.operators && (
                                <div className="text-xs text-gray-500 dark:text-gray-400">
                                  <span className="font-medium">干员:</span> {copilotSetInfo.operators}
                                </div>
                              )}
                            </>
                          )}
                          <Button
                            onClick={() => setCopilotSetInfo(null)}
                            variant="ghost"
                            size="sm"
                            className="mt-2 text-xs"
                          >
                            清除预览
                          </Button>
                        </div>
                      ) : (
                        <div className="text-center py-4 text-gray-400 dark:text-gray-500 text-xs">
                          <svg className="w-8 h-8 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <p>预览作业后显示详情</p>
                        </div>
                      )}
                    </div>
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
                  className="rounded-3xl p-6 border border-gray-200 dark:border-white/10 hover:border-teal-400 dark:hover:border-teal-500/30 transition-all bg-white dark:bg-gray-900/60 hover:shadow-lg"
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
                      gradientFrom="teal"
                      gradientTo="cyan"
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
                      <div className="rounded-2xl p-4 border border-teal-200 dark:border-teal-500/20 bg-teal-50 dark:bg-teal-900/10">
                        <div className="flex items-center space-x-2 mb-3">
                          <svg className="w-5 h-5 text-teal-600 dark:text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                          <h5 className="text-sm font-semibold text-teal-900 dark:text-teal-100">快速搜索</h5>
                        </div>
                        <div className="flex space-x-2">
                          <input
                            type="text"
                            placeholder="输入干员名字，如：古米、能天使"
                            value={paradoxSearchName}
                            onChange={(e) => setParadoxSearchName(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleSearchParadox()}
                            className="flex-1 px-4 py-2 border border-teal-300 dark:border-teal-500/30 rounded-xl text-sm text-gray-900 dark:text-gray-200 bg-white dark:bg-[#070707] focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all"
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
                            <div className="text-xs text-teal-700 dark:text-teal-300 font-medium">
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
                                    className="w-full text-left px-3 py-2 rounded-lg bg-white dark:bg-gray-800/60 border border-teal-200 dark:border-teal-500/20 hover:border-teal-400 dark:hover:border-teal-500/40 transition-all text-xs"
                                  >
                                    <div className="flex items-center justify-between">
                                      <span className="font-mono text-teal-600 dark:text-teal-400">{copilot.uri}</span>
                                      {idx === 0 && (
                                        <span className="px-2 py-0.5 bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 rounded text-xs font-medium">推荐</span>
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
                      className="w-full px-4 py-3 border border-gray-300 dark:border-white/10 rounded-2xl text-sm font-medium text-gray-900 dark:text-gray-200 bg-white dark:bg-[#070707] focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent resize-none font-mono transition-all"
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
