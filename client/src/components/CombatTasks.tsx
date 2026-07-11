import { useState, useEffect } from 'react'
import { maaApi, searchCopilot, searchParadoxCopilot } from '../services/api'
import { motion, useReducedMotion } from 'framer-motion'
import Icons from './Icons'
import { PageHeader, Button } from './common'
import { useStatusStore } from '../store/statusStore'
import FloatingStatusIndicator from './FloatingStatusIndicator'
import { useFluidTabIndicator } from '../hooks/useFluidTabIndicator'
import type {
  CombatTasksProps,
  CombatTask,
  CombatAdvancedOption,
  CombatTaskInputs,
  CombatAdvancedParams,
  AutoFormationConfig,
  FormationMode,
  CopilotSetInfo,
  CopilotSearchResult,
  ParadoxSearchResult,
  CopilotSetItem
} from '@/types/components'

type CopilotSetExecutionMode = 'app' | 'manual' | 'cli'
type CopilotSetSelections = Record<string, number[]>
type CombatMode = 'copilot' | 'ssscopilot' | 'paradoxcopilot'

export default function CombatTasks(_props: CombatTasksProps) {
  const shouldReduceMotion = useReducedMotion()
  const [isRunning, setIsRunning] = useState(false)
  const { setMessage: setStatusMessage, setActive: setIsActiveStatus } = useStatusStore()
  const [taskInputs, setTaskInputs] = useState<CombatTaskInputs>({})
  const [copilotSetInfo, setCopilotSetInfo] = useState<CopilotSetInfo | null>(null)
  const [isLoadingSet, setIsLoadingSet] = useState(false)
  const [advancedParams, setAdvancedParams] = useState<CombatAdvancedParams>({
    copilot: { ignoreRequirements: true, loopTimes: '1', executionStrategy: 'continue', raid: 'normal' },
    paradoxcopilot: { executionStrategy: 'continue' },
    ssscopilot: { loopTimes: '1' }
  })
  const [autoFormation, setAutoFormation] = useState<AutoFormationConfig>({ copilot: 'auto' })
  const [copilotSetExecutionMode, setCopilotSetExecutionMode] = useState<CopilotSetExecutionMode>('cli')

  // 作业类型选择：'auto' 自动检测，'single' 单个作业，'set' 作业集
  const [copilotType, setCopilotType] = useState<'auto' | 'single' | 'set'>('auto')

  // 作业集执行控制
  const [waitingForNextCopilot, setWaitingForNextCopilot] = useState(false)
  const [currentCopilotTask, setCurrentCopilotTask] = useState<CombatTask | null>(null)
  const [copilotSetResults, setCopilotSetResults] = useState<{ index: number; success: boolean; error?: string }[]>([])

  // 作业集任务选择状态（记录选中的索引）
  const [selectedCopilotIndexes, setSelectedCopilotIndexes] = useState<Set<number>>(new Set())
  const [copilotSetSelections, setCopilotSetSelections] = useState<CopilotSetSelections>({})

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
  const [selectedSearchCopilotUri, setSelectedSearchCopilotUri] = useState<string>('')
  const [isSearchingCopilot, setIsSearchingCopilot] = useState(false)
  const [activeCombatMode, setActiveCombatMode] = useState<CombatMode>('copilot')
  const { containerRef: combatModeTabsRef, activeRect: activeCombatModeRect, setTabRef: setCombatModeTabRef } = useFluidTabIndicator(activeCombatMode)

  const normalizeFormationMode = (value: AutoFormationConfig[string] | undefined): FormationMode => {
    if (value === true) return 'on'
    if (value === false) return 'off'
    if (value === 'on' || value === 'off' || value === 'auto') return value
    return 'auto'
  }

  const getFormationMode = (taskId: string): FormationMode => normalizeFormationMode(autoFormation[taskId])

  const normalizeRaidValue = (value: unknown): 'normal' | 'raid' | 'both' => {
    if (value === '1' || value === 'raid') return 'raid'
    if (value === '2' || value === 'both') return 'both'
    return 'normal'
  }

  const normalizeAdvancedConfig = (advanced: CombatAdvancedParams): CombatAdvancedParams => ({
    ...advanced,
    copilot: {
      ...advanced.copilot,
      raid: normalizeRaidValue(advanced.copilot?.raid)
    }
  })

  const shouldAppendFormation = (taskId: string, forceForSplitSet = false): boolean => {
    if (taskId !== 'copilot') return false
    const mode = getFormationMode(taskId)
    if (mode === 'on') return true
    if (mode === 'off') return false
    return forceForSplitSet
  }

  const getSelectedCopilotIndexes = (): number[] => {
    if (!copilotSetInfo?.copilots?.length) return []
    return copilotSetInfo.copilots
      .map((_, index) => index)
      .filter(index => selectedCopilotIndexes.has(index))
  }

  const serializeSelectedCopilotIndexes = (indexes: Set<number>): number[] =>
    [...indexes].filter(Number.isInteger).sort((a, b) => a - b)

  const applySelectedCopilotIndexes = (indexes: Set<number>, setId = copilotSetInfo?.id) => {
    const normalized = new Set(serializeSelectedCopilotIndexes(indexes))
    setSelectedCopilotIndexes(normalized)
    if (!setId) return
    setCopilotSetSelections(prev => ({
      ...prev,
      [setId]: serializeSelectedCopilotIndexes(normalized)
    }))
  }

  const restoreSelectedCopilots = (setId: string, copilots: CopilotSetItem[]) => {
    const savedIndexes = copilotSetSelections[setId]
    const raid = normalizeRaidValue(advancedParams.copilot?.raid)
    const pendingIndexes = copilots
      .map((copilot, index) => {
        const requiredModes: Array<'normal' | 'raid'> = copilot.presetFormation
          ? ['normal']
          : raid === 'both'
            ? ['normal', 'raid']
            : [raid === 'raid' ? 'raid' : 'normal']
        return requiredModes.every(mode => copilot.completedModes?.includes(mode)) ? -1 : index
      })
      .filter(index => index >= 0)
    const indexes = Array.isArray(savedIndexes)
      ? savedIndexes.filter(index => Number.isInteger(index) && pendingIndexes.includes(index))
      : pendingIndexes
    applySelectedCopilotIndexes(new Set(indexes), setId)
  }

  const resetCopilotSetProgress = () => {
    if (!copilotSetInfo?.copilots?.length) return
    applySelectedCopilotIndexes(new Set(copilotSetInfo.copilots.map((_, index) => index)), copilotSetInfo.id)
    setCopilotSetResults([])
    setCopilotSetInfo(prev => prev ? { ...prev, currentIndex: 0 } : prev)
    maaApi.resetCopilotSetProgress(copilotSetInfo.id).catch(() => {})
    setStatusMessage('已重置作业集进度，将从第一关开始')
    setTimeout(() => setStatusMessage(''), 2000)
  }

  // 页面加载时从服务器或 localStorage 加载配置和恢复执行状态
  useEffect(() => {
    // 从后端获取真实的任务执行状态
    const checkBackendStatus = async () => {
      try {
        const result = await maaApi.getTaskStatus()
        const taskStatus = result.data
        if (result.success && taskStatus?.isRunning) {
          // 后端确实有任务在运行
          const { taskName, startTime, taskType } = taskStatus

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
          const {
            taskInputs: inputs,
            advancedParams: advanced,
            autoFormation: formation,
            copilotSetExecutionMode: savedSetMode,
            copilotSetSelections: savedSelections
          } = serverConfig.data
          if (inputs) {
            setTaskInputs(inputs)
            localStorage.setItem('combatTaskInputs', JSON.stringify(inputs))
          }
          if (advanced) {
            const normalizedAdvanced = normalizeAdvancedConfig(advanced)
            setAdvancedParams(normalizedAdvanced)
            localStorage.setItem('combatAdvancedParams', JSON.stringify(normalizedAdvanced))
          }
          if (formation) {
            setAutoFormation(formation)
            localStorage.setItem('combatAutoFormation', JSON.stringify(formation))
          }
          if (savedSetMode === 'app' || savedSetMode === 'manual' || savedSetMode === 'cli') {
            const migratedSetMode = savedSetMode === 'app' ? 'cli' : savedSetMode
            setCopilotSetExecutionMode(migratedSetMode)
            localStorage.setItem('combatCopilotSetExecutionMode', migratedSetMode)
          }
          if (savedSelections && typeof savedSelections === 'object') {
            setCopilotSetSelections(savedSelections)
            localStorage.setItem('combatCopilotSetSelections', JSON.stringify(savedSelections))
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
      const savedSetMode = localStorage.getItem('combatCopilotSetExecutionMode')
      const savedSelections = localStorage.getItem('combatCopilotSetSelections')

      if (savedInputs) {
        setTaskInputs(JSON.parse(savedInputs))
      }
      if (savedAdvanced) {
        setAdvancedParams(normalizeAdvancedConfig(JSON.parse(savedAdvanced)))
      }
      if (savedFormation) {
        setAutoFormation(JSON.parse(savedFormation))
      }
      if (savedSetMode === 'app' || savedSetMode === 'manual' || savedSetMode === 'cli') {
        setCopilotSetExecutionMode(savedSetMode === 'app' ? 'cli' : savedSetMode)
      }
      if (savedSelections) {
        setCopilotSetSelections(JSON.parse(savedSelections))
      }
    }

    loadConfig()
  }, [])

  // 自动保存配置
  useEffect(() => {
    localStorage.setItem('combatTaskInputs', JSON.stringify(taskInputs))
    // 同时保存到服务器（静默失败）
    maaApi.saveUserConfig('combat-tasks', {
      taskInputs,
      advancedParams,
      autoFormation,
      copilotSetExecutionMode,
      copilotSetSelections
    }).catch(() => {})
  }, [taskInputs, advancedParams, autoFormation, copilotSetExecutionMode, copilotSetSelections])

  useEffect(() => {
    localStorage.setItem('combatAdvancedParams', JSON.stringify(advancedParams))
  }, [advancedParams])

  useEffect(() => {
    localStorage.setItem('combatAutoFormation', JSON.stringify(autoFormation))
  }, [autoFormation])

  useEffect(() => {
    localStorage.setItem('combatCopilotSetExecutionMode', copilotSetExecutionMode)
  }, [copilotSetExecutionMode])

  useEffect(() => {
    localStorage.setItem('combatCopilotSetSelections', JSON.stringify(copilotSetSelections))
  }, [copilotSetSelections])

  const tasks: CombatTask[] = [
    {
      id: 'copilot',
      name: '自动战斗作业',
      command: 'copilot',
      placeholder: 'maa://1234、作业站链接或本地文件路径',
      icon: <Icons.Document />,
      hasAdvanced: true,
      description: '支持单作业、作业集、作业站链接、循环次数与失败处理策略'
    },
    {
      id: 'ssscopilot',
      name: '保全派驻',
      command: 'ssscopilot',
      placeholder: 'maa://1234 或本地文件路径',
      icon: <Icons.Shield />,
      hasAdvanced: true,
      description: '保全派驻 SSS 作业入口，当前 maa-cli 一次只执行一个 SSS 作业'
    },
    {
      id: 'paradoxcopilot',
      name: '悖论模拟',
      command: 'paradoxcopilot',
      placeholder: 'maa://1234 或本地文件路径',
      icon: <Icons.Puzzle />,
      hasAdvanced: true,
      description: '悖论模拟独立作业入口，可按干员搜索推荐作业并单独诊断'
    },
  ]

  const getAdvancedOptions = (taskId: string): CombatAdvancedOption[] => {
    const options: Record<string, CombatAdvancedOption[]> = {
      copilot: [
        { key: 'ignoreRequirements', label: '忽略干员要求', type: 'checkbox', param: '--ignore-requirements' },
        { key: 'loopTimes', label: '循环次数', type: 'number', param: '--loop-times', placeholder: '1' },
        { key: 'executionStrategy', label: '队列策略', type: 'select', param: '', options: [
          { value: 'continue', label: '失败继续下一个' },
          { value: 'stop', label: '失败后停止' },
        ]},
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
      paradoxcopilot: [
        { key: 'executionStrategy', label: '队列策略', type: 'select', param: '', options: [
          { value: 'continue', label: '失败继续' },
          { value: 'stop', label: '失败停止' },
        ]},
      ],
    }
    return options[taskId] || []
  }

  const normalizeCopilotInput = (input: string): string => {
    return input
      .split(/\n+/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(item => {
        const maaMatch = item.match(/^maa:\/\/(\d+)(s?)$/i)
        if (maaMatch) {
          return `maa://${maaMatch[1]}${maaMatch[2] || ''}`
        }
        if (!/^https?:\/\//i.test(item)) return item

        try {
          const url = new URL(item)
          const idMatch = `${url.pathname} ${url.search}`.match(/(\d+)(s?)(?!.*\d)/)
          const looksLikeSet = /set|collection|合集|作业集/i.test(url.pathname + url.search)
          if (idMatch) {
            const suffix = looksLikeSet || idMatch[2] === 's' ? 's' : ''
            return `maa://${idMatch[1]}${suffix}`
          }
        } catch {
          // URL 解析失败时保留原始输入，交给 maa-cli 报错
        }

        return item
      })
      .join(' ')
  }

  const splitCopilotInputToArgs = (input: string): string[] => {
    const normalized = normalizeCopilotInput(input)
    return normalized
      ? (normalized.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [])
          .map(arg => arg.replace(/^("|')|("|')$/g, ''))
          .filter(Boolean)
      : []
  }


  const appendCommandOptions = (args: string[], task: CombatTask, forceFormationForSplitSet = false): string[] => {
    const nextArgs = [...args]
    if (shouldAppendFormation(task.id, forceFormationForSplitSet)) {
      nextArgs.push('--formation')
    }

    const advanced = advancedParams[task.id] || {}
    const raidValue = normalizeRaidValue(advanced.raid)
    if (task.id === 'copilot' && raidValue !== 'normal') {
      nextArgs.push('--raid', raidValue)
    }

    getAdvancedOptions(task.id).forEach(option => {
      const value = advanced[option.key]
      if (!option.param || value === undefined || value === '' || value === false) return
      if (option.type === 'checkbox' && value === true) {
        nextArgs.push(option.param)
      } else if (option.type !== 'checkbox') {
        nextArgs.push(option.param, String(value))
      }
    })

    return nextArgs
  }

  const buildCommandArgs = (task: CombatTask): string[] => {
    const args = splitCopilotInputToArgs(taskInputs[task.id] || '')

    if (task.id === 'copilot' && copilotSetInfo?.type === 'set' && copilotSetInfo?.autoAddS) {
      for (let i = 0; i < args.length; i++) {
        args[i] = (args[i] || '').replace(/^maa:\/\/(\d+)(?!s)$/i, 'maa://$1s')
      }
    }

    return appendCommandOptions(args, task)
  }

  const buildCopilotSetCliArgs = (task: CombatTask): string[] => {
    const selectedIndexes = getSelectedCopilotIndexes()
    const totalCount = copilotSetInfo?.copilots?.length || 0
    if (copilotSetInfo?.type === 'set' && copilotSetInfo.copilots && selectedIndexes.length > 0 && selectedIndexes.length < totalCount) {
      const selectedArgs = selectedIndexes
        .map(index => copilotSetInfo.copilots?.[index])
        .filter((copilot): copilot is CopilotSetItem => !!copilot)
        .map(copilot => `maa://${copilot.id}`)
      return appendCommandOptions(selectedArgs, task)
    }

    return buildCommandArgs(task)
  }

  // 执行单个作业（等待完成）
  const executeSingleCopilot = async (task: CombatTask, args: string[]): Promise<{ success: boolean; error?: string }> => {
    // waitForCompletion: true 表示等待命令执行完成后再返回
    const result = await maaApi.executePredefinedTaskArgs(task.command, args, null, null, task.name, 'combat', true)
    return result
  }

  // 构建作业参数
  const buildCopilotArgs = (copilotId: number, task: CombatTask): string[] => {
    const args = [`maa://${copilotId}`]
    return appendCommandOptions(args, task, true)
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

    const args = buildCopilotArgs(copilot.id, task)

    try {
      const result = await executeSingleCopilot(task, args)
      return result
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }

  // 应用内连续执行作业集，可确定按前端策略跳过失败作业
  const startCopilotSetSequentially = async (task: CombatTask) => {
    if (!copilotSetInfo?.copilots || copilotSetInfo.copilots.length === 0) {
      setStatusMessage('作业集为空')
      return
    }

    const selectedIndexes = getSelectedCopilotIndexes()
    if (!selectedIndexes.length) {
      setStatusMessage('请至少选择一个作业')
      return
    }

    setIsRunning(true)
    setWaitingForNextCopilot(false)
    setCopilotSetResults([])
    setCurrentCopilotTask(task)

    const strategy = advancedParams.copilot?.executionStrategy || 'continue'
    const results: { index: number; success: boolean; error?: string }[] = []
    const remainingIndexes = new Set(selectedIndexes)
    const setId = copilotSetInfo.id

    for (const [order, index] of selectedIndexes.entries()) {
      const result = await executeCopilotAtIndex(task, index)
      const errorMessage = result.error || maaApi.getErrorMessage({ message: result.error }) || '未知错误'
      results.push({ index, success: result.success, error: errorMessage })
      setCopilotSetResults([...results])

      const isLast = order === selectedIndexes.length - 1
      if (result.success) {
        remainingIndexes.delete(index)
        applySelectedCopilotIndexes(remainingIndexes, setId)
      }
      if (!result.success) {
        if (strategy === 'stop') {
          setStatusMessage(`作业 ${index + 1} 执行失败: ${errorMessage}，已按策略停止`)
          finishCopilotSet()
          return
        }
        if (!isLast) {
          setStatusMessage(`作业 ${index + 1} 执行失败: ${errorMessage}，已跳过并继续下一关`)
        }
      }
    }

    const successCount = results.filter(result => result.success).length
    setStatusMessage(`作业集执行完成 (${successCount}/${selectedIndexes.length} 成功)`)
    finishCopilotSet()
  }

  // 交给 maa-cli 原生作业集/多 URI 流程执行
  const startCopilotSetWithCli = async (task: CombatTask) => {
    const selectedIndexes = getSelectedCopilotIndexes()
    if (!selectedIndexes.length) {
      setStatusMessage('请至少选择一个作业')
      return
    }

    setIsRunning(true)
    setWaitingForNextCopilot(false)
    setCopilotSetResults([])
    setCurrentCopilotTask(task)
    setStatusMessage('正在执行作业集（CLI 原生连续）')

    try {
      const raid = normalizeRaidValue(advancedParams.copilot?.raid)
      const result = copilotSetInfo?.type === 'set'
        ? await maaApi.executeCopilotSetPlan(copilotSetInfo.id, {
            raid,
            selectedIndexes,
            options: {
              ignoreRequirements: advancedParams.copilot?.ignoreRequirements,
              loopTimes: advancedParams.copilot?.loopTimes,
              useSanityPotion: advancedParams.copilot?.useSanityPotion,
              addTrust: advancedParams.copilot?.addTrust,
              formationIndex: advancedParams.copilot?.formationIndex,
              supportUsage: advancedParams.copilot?.supportUsage,
              supportName: advancedParams.copilot?.supportName,
              formationMode: getFormationMode(task.id)
            }
          })
        : await maaApi.executePredefinedTaskArgs(task.command, buildCopilotSetCliArgs(task), null, null, task.name, 'combat', true)

      if (result.success) {
        const pendingIndexes = new Set<number>((result.data?.pending || []).map((entry: { itemIndex: number }) => entry.itemIndex))
        applySelectedCopilotIndexes(pendingIndexes, copilotSetInfo?.id)
        setStatusMessage(pendingIndexes.size ? `作业集已完成部分关卡，剩余 ${pendingIndexes.size} 个待执行` : '作业集执行完成')
      } else {
        setStatusMessage(`作业集执行失败: ${maaApi.getErrorMessage(result)}`)
      }
      await new Promise(resolve => setTimeout(resolve, 2000))
      setStatusMessage('')
    } catch (error) {
      setStatusMessage(`网络错误: ${(error as Error).message}`)
      await new Promise(resolve => setTimeout(resolve, 2000))
      setStatusMessage('')
    } finally {
      finishCopilotSet()
    }
  }

  // 手动逐关执行作业集（执行第一个选中的作业）
  const startCopilotSetManually = async (task: CombatTask) => {
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
    const errorMessage = result.error || maaApi.getErrorMessage({ message: result.error }) || '未知错误'
    setCopilotSetResults([{ index: firstSelectedIndex, success: result.success, error: errorMessage }])
    const remainingIndexes = new Set(selectedCopilotIndexes)
    if (result.success) {
      remainingIndexes.delete(firstSelectedIndex)
      applySelectedCopilotIndexes(remainingIndexes, copilotSetInfo.id)
    }

    // 计算剩余选中的作业数量
    const remainingSelected = remainingIndexes.size

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
      const strategy = advancedParams.copilot?.executionStrategy || 'continue'
      if (strategy === 'stop') {
        setStatusMessage(`作业 ${firstSelectedIndex + 1} 执行失败: ${errorMessage}，已按策略停止`)
        finishCopilotSet()
      } else if (remainingSelected > 0) {
        setStatusMessage(`作业 ${firstSelectedIndex + 1} 执行失败: ${errorMessage}，等待开始下一关`)
        setWaitingForNextCopilot(true)
      } else {
        setStatusMessage(`作业执行失败: ${errorMessage}`)
        finishCopilotSet()
      }
    }
  }

  const startCopilotSet = async (task: CombatTask) => {
    if (copilotSetExecutionMode === 'cli') {
      await startCopilotSetWithCli(task)
      return
    }
    if (copilotSetExecutionMode === 'manual') {
      await startCopilotSetManually(task)
      return
    }
    await startCopilotSetSequentially(task)
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
    const nextErrorMessage = result.error || maaApi.getErrorMessage({ message: result.error }) || '未知错误'
    setCopilotSetResults(prev => [...prev, { index: nextIndex, success: result.success, error: nextErrorMessage }])
    const remainingIndexes = new Set(selectedCopilotIndexes)
    if (result.success) {
      remainingIndexes.delete(nextIndex)
      applySelectedCopilotIndexes(remainingIndexes, copilotSetInfo.id)
    }

    // 计算剩余选中的作业数量
    const remainingSelected = remainingIndexes.size

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
      const strategy = advancedParams.copilot?.executionStrategy || 'continue'
      if (strategy === 'stop') {
        setStatusMessage(`作业 ${nextIndex + 1} 执行失败: ${nextErrorMessage}，已按策略停止`)
        finishCopilotSet()
      } else if (remainingSelected > 0) {
        setStatusMessage(`作业 ${nextIndex + 1} 执行失败: ${nextErrorMessage}，等待开始下一关`)
        setWaitingForNextCopilot(true)
      } else {
        setStatusMessage(`作业 ${nextIndex + 1} 执行失败: ${nextErrorMessage}`)
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

    if (task.id === 'ssscopilot') {
      const args = splitCopilotInputToArgs(inputValue)
      if (args.length !== 1) {
        setStatusMessage('保全派驻一次只能执行一个 SSS 作业 URI')
        setTimeout(() => setStatusMessage(''), 2000)
        return
      }
    }

    if (task.id === 'copilot' && !copilotSetInfo) {
      const firstArg = splitCopilotInputToArgs(inputValue)[0] || ''
      if (/^maa:\/\/\d+s$/i.test(firstArg)) {
        await handlePreviewCopilotSetWithInput(inputValue)
        setStatusMessage('已恢复作业集进度，请确认待执行关卡后再次执行')
        setTimeout(() => setStatusMessage(''), 2500)
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
        const args = buildCommandArgs(task)
        const result = await maaApi.executePredefinedTaskArgs(task.command, args, null, null, task.name, 'combat')

        if (result.success) {
          setStatusMessage(`${task.name} 执行成功`)
          await new Promise(resolve => setTimeout(resolve, 2000))
          setStatusMessage('')
        } else {
          setStatusMessage(`执行失败: ${maaApi.getErrorMessage(result)}`)
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
      if (value.trim() !== selectedSearchCopilotUri) {
        setSelectedSearchCopilotUri('')
      }
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
  const unwrapApiPayload = (response: any) => {
    if (!response || typeof response !== 'object') return null
    if (response.success === true && response.data) return response.data
    return response
  }

  const getCopilotContent = (response: any) => {
    const payload = unwrapApiPayload(response)
    if (payload?.status_code !== 200 || !payload?.data?.content) return null
    try {
      return JSON.parse(payload.data.content)
    } catch {
      return null
    }
  }

  const getCopilotSetIds = (response: any): number[] => {
    const payload = unwrapApiPayload(response)
    const rawIds = payload?.data?.copilot_ids
    return Array.isArray(rawIds) ? rawIds.map((id: unknown) => Number(id)).filter(Number.isFinite) : []
  }

  const fetchCopilotDetail = async (copilotId: number): Promise<CopilotSetItem | null> => {
    try {
      const response = await maaApi.getCopilotInfo(String(copilotId))
      const content = getCopilotContent(response)
      if (content) {
        return {
          id: copilotId,
          name: content.doc?.title || '未命名作业',
          stage: content.stage_name,
          operators: extractOperators(content),
          uri: `maa://${copilotId}`
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
      const planResponse = await maaApi.getCopilotSetPlan(setId, normalizeRaidValue(advancedParams.copilot?.raid))
      const plan = unwrapApiPayload(planResponse)
      if (Array.isArray(plan?.items) && plan.items.length > 0) {
        return plan.items.map((item: any, itemIndex: number) => ({
          id: Number(item.id),
          name: item.stage || `作业 #${item.id}`,
          stage: item.stage,
          stageId: item.stageId,
          presetFormation: Boolean(item.presetFormation),
          supportsRaid: item.supportsRaid !== false,
          completedModes: Array.isArray(plan.entries)
            ? plan.entries
                .filter((entry: any) => entry.itemIndex === itemIndex && entry.completed)
                .map((entry: any) => entry.mode as 'normal' | 'raid')
            : [],
          uri: `maa://${item.id}`
        }))
      }
      const data = await maaApi.getCopilotSet(setId)
      const copilotIds = getCopilotSetIds(data)
      if (copilotIds.length > 0) {
        // 并行获取所有作业详情
        const details = await Promise.all(copilotIds.map(id => fetchCopilotDetail(id)))
        return details.filter((item): item is CopilotSetItem => item !== null)
      }
    } catch {
      // 忽略错误
    }
    return []
  }

  const applyCopilotUri = async (uri: string) => {
    const normalizedUri = normalizeCopilotInput(uri).trim()
    setTaskInputs(prev => ({ ...prev, copilot: normalizedUri }))
    setSelectedSearchCopilotUri(normalizedUri)
    setCopilotSetInfo(null)
    await handlePreviewCopilotSetWithInput(normalizedUri)
  }

  const handlePreviewCopilotSetWithInput = async (rawValue?: string) => {
    const rawInput = rawValue ?? (taskInputs['copilot'] || '')
    const normalizedInput = normalizeCopilotInput(rawInput).trim()
    const firstToken = normalizedInput.split(/\s+/)[0] || ''
    const match = firstToken.match(/^maa:\/\/(\d+)(s?)$/)

    if (!match) {
      setStatusMessage('请输入有效的作业 URI / 作业站链接（如: maa://26766）')
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
        const copilotData = await maaApi.getCopilotInfo(copilotId)
        const content = getCopilotContent(copilotData)
        if (content) {
          setCopilotSetInfo({
            type: 'single',
            id: copilotId,
            name: content.doc?.title || '未命名作业',
            stage: content.stage_name,
            operators: extractOperators(content)
          })
          setStatusMessage(`已加载作业：${content.doc?.title || content.stage_name}`)
        } else {
          setStatusMessage('作业不存在')
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
          restoreSelectedCopilots(copilotId, copilots)
          setStatusMessage(`已加载作业集：${copilots.length} 个作业`)
        } else {
          setStatusMessage('作业集不存在或为空')
        }
      } else {
        // 自动检测模式：同时请求两个接口，哪个成功就用哪个
        const [copilotResult, setResult] = await Promise.allSettled([
          maaApi.getCopilotInfo(copilotId),
          maaApi.getCopilotSet(copilotId)
        ])

        let foundSingle = false
        let foundSet = false
        let singleData: any = null
        let setData: any = null

        // 检查单个作业
        if (copilotResult.status === 'fulfilled') {
          const content = getCopilotContent(copilotResult.value)
          if (content) {
            foundSingle = true
            singleData = content
          }
        }

        // 检查作业集
        if (setResult.status === 'fulfilled') {
          const copilotIds = getCopilotSetIds(setResult.value)
          if (copilotIds.length > 0) {
            foundSet = true
            setData = copilotIds
          }
        }

        // 根据结果决定使用哪个
        if (foundSingle && foundSet) {
          // 两个都存在，优先使用作业集（因为作业集更少见，用户可能更想要）
          const copilotIds: number[] = setData
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
          restoreSelectedCopilots(copilotId, validCopilots)
          setStatusMessage(`已识别作业集：${validCopilots.length} 个作业`)
        } else if (foundSet) {
          // 只有作业集
          const copilotIds: number[] = setData
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
          restoreSelectedCopilots(copilotId, validCopilots)
          setStatusMessage(`已加载作业集：${validCopilots.length} 个作业`)
        } else if (foundSingle) {
          // 只有单个作业
          const content = singleData
          setCopilotSetInfo({
            type: 'single',
            id: copilotId,
            name: content.doc?.title || '未命名作业',
            stage: content.stage_name,
            operators: extractOperators(content)
          })
          setStatusMessage(`已加载作业：${content.doc?.title || content.stage_name}`)
        } else {
          const singlePayload = copilotResult.status === 'fulfilled' ? unwrapApiPayload(copilotResult.value) : null
          const setPayload = setResult.status === 'fulfilled' ? unwrapApiPayload(setResult.value) : null
          const looksLikeSetFallback = singlePayload?.status_code === 404 && setPayload?.status_code === 400

          if (looksLikeSetFallback) {
            setCopilotSetInfo({
              type: 'set',
              id: copilotId,
              name: '作业集',
              note: `当前接口未返回 ${copilotId} 的明细，执行时将按作业集处理${!hasS ? '（自动补 s）' : ''}`,
              autoAddS: !hasS,
              copilots: [],
              currentIndex: 0
            })
            applySelectedCopilotIndexes(new Set(), copilotId)
            setStatusMessage(`已按作业集处理：maa://${copilotId}${!hasS ? '（执行时自动补 s）' : ''}`)
          } else {
            setStatusMessage('未找到作业或作业集')
          }
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
      const result = await searchCopilot(copilotSearchStage.trim())

      // 适配新的响应格式：数据在 result.data 中
      const data = result.data || result

      if (result.success && data.copilots && data.copilots.length > 0) {
        console.log('[copilot-search]', data)
        setCopilotSearchResult(data)

        // 自动填充并预览推荐作业
        if (data.recommended?.uri) {
          await applyCopilotUri(data.recommended.uri)
        } else {
          setStatusMessage(`找到 ${data.copilots.length} 个作业`)
          await new Promise(resolve => setTimeout(resolve, 1500))
          setStatusMessage('')
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
        className="mt-3 space-y-3 border-t border-[var(--app-border)] pt-3"
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        transition={{ duration: 0.3 }}
      >
        {options.map(option => (
          <div key={option.key} className="min-w-0">
            {option.type === 'checkbox' ? (
              <label className="group flex min-w-0 cursor-pointer items-center gap-2 text-sm text-secondary">
                <input
                  type="checkbox"
                  checked={advanced[option.key] as boolean || false}
                  onChange={(e) => handleAdvancedChange(task.id, option.key, e.target.checked)}
                  className="custom-checkbox h-4 w-4 cursor-pointer"
                />
                <span className="min-w-0 truncate transition-colors group-hover:text-[var(--app-accent)]">{option.label}</span>
              </label>
            ) : option.type === 'select' && option.options ? (
              <div className="grid min-w-0 gap-1.5 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center">
                <label className="text-sm text-secondary">{option.label}</label>
                <select
                  value={(advanced[option.key] as string) || (option.options[0]?.value || '')}
                  onChange={(e) => handleAdvancedChange(task.id, option.key, e.target.value)}
                  className="min-w-0 rounded-lg border border-[var(--app-border)] px-3 py-2 text-sm text-primary control-surface focus:outline-none focus:ring-2 focus:ring-[var(--app-accent-soft)]"
                >
                  {option.options.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="grid min-w-0 gap-1.5 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center">
                <label className="text-sm text-secondary">{option.label}</label>
                <input
                  type={option.type}
                  name={`maa-${task.id}-${option.key}`}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={advanced[option.key] as string || ''}
                  onChange={(e) => handleAdvancedChange(task.id, option.key, e.target.value)}
                  placeholder={option.placeholder}
                  className="min-w-0 rounded-lg border border-[var(--app-border)] px-3 py-2 text-sm text-primary control-surface focus:outline-none focus:ring-2 focus:ring-[var(--app-accent-soft)]"
                />
              </div>
            )}
          </div>
        ))}
      </motion.div>
    )
  }

  const combatModeOptions = [
    { id: 'copilot' as const, title: '普通作业', desc: '单作业 / 作业集 / 链接识别', icon: <Icons.Document /> },
    { id: 'ssscopilot' as const, title: '保全派驻', desc: 'SSS 作业独立入口', icon: <Icons.Shield /> },
    { id: 'paradoxcopilot' as const, title: '悖论模拟', desc: '按干员搜索作业', icon: <Icons.Puzzle /> },
  ]
  const activeCombatModeOption = combatModeOptions.find(option => option.id === activeCombatMode)

  return (
    <>
      <div className="app-page app-stack-section">
        <PageHeader
          icon={<Icons.TargetIcon />}
          title="自动战斗"
          subtitle="单作业 / 作业集 / SSS / 悖论模拟 / 链接识别 - 跟进最新 MaaCore 作业能力"
          actions={<FloatingStatusIndicator />}
        />

        <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur">
          <div ref={combatModeTabsRef} className="relative grid grid-cols-1 gap-1 sm:grid-cols-3">
            {activeCombatModeOption && activeCombatModeRect.width > 0 && (
              <motion.div
                data-testid="combat-mode-highlight"
                aria-hidden="true"
                className="pointer-events-none absolute z-20 flex items-center gap-3 rounded-lg bg-[var(--app-accent)] px-3.5 py-2.5 text-left text-white shadow-[0_10px_24px_color-mix(in_srgb,var(--app-accent)_22%,transparent)]"
                initial={false}
                animate={{
                  x: activeCombatModeRect.x,
                  y: activeCombatModeRect.y,
                  width: activeCombatModeRect.width,
                  height: activeCombatModeRect.height,
                }}
                transition={shouldReduceMotion
                  ? { duration: 0 }
                  : { type: 'spring', stiffness: 420, damping: 38, mass: 0.72 }}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/16 text-white [&_*]:h-4 [&_*]:w-4">
                  {activeCombatModeOption.icon}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{activeCombatModeOption.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-white/75">{activeCombatModeOption.desc}</span>
                </span>
              </motion.div>
            )}
            {combatModeOptions.map(({ id, title, desc, icon }) => (
              <button
                key={id}
                ref={(element) => {
                  setCombatModeTabRef(id)(element)
                }}
                type="button"
                onClick={() => setActiveCombatMode(id)}
                aria-pressed={activeCombatMode === id}
                className={`group relative z-10 flex min-w-0 items-center gap-3 rounded-lg px-3.5 py-2.5 text-left transition-colors ${
                  activeCombatMode === id
                    ? 'text-transparent'
                    : 'text-secondary hover:bg-white/70 hover:text-primary dark:hover:bg-white/10'
                }`}
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors [&_*]:h-4 [&_*]:w-4 ${
                  activeCombatMode === id
                    ? 'opacity-0'
                    : 'bg-[var(--app-surface-muted)] text-[var(--app-accent-strong)] group-hover:bg-[var(--app-accent-soft)]'
                }`}>
                  {icon}
                </span>
                <span className={`min-w-0 ${activeCombatMode === id ? 'opacity-0' : ''}`}>
                  <span className="block truncate text-sm font-semibold">{title}</span>
                  <span className="mt-0.5 block truncate text-xs text-tertiary">{desc}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* 任务列表 */}
        <div className="app-stack-section">
          {/* 自动抄作业 - 单独一行 */}
          {activeCombatMode === 'copilot' && tasks.filter(task => task.id === 'copilot').map((task) => {
            return (
              <div
                key={task.id}
                className="rounded-xl border border-[var(--app-border)] p-5 surface-panel"
              >
                <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg brand-action-subtle [&_*]:h-4 [&_*]:w-4">
                      {task.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="truncate text-xl font-semibold tracking-tight text-primary">{task.name}</h4>
                        <span className="shrink-0 rounded-md border border-[var(--app-border)] px-2 py-0.5 font-mono text-[11px] text-tertiary">{task.command}</span>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-secondary">{task.description}</p>
                    </div>
                  </div>

                  <Button
                    onClick={() => handleExecute(task)}
                    disabled={isRunning}
                    variant="gradient"
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

                {/* 作业配置区 */}
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)_320px]">
                  {/* 左栏：设置项 */}
                  <div className="space-y-3 xl:sticky xl:top-24">
                    <div className="rounded-lg border border-[var(--app-border)] p-4 surface-soft">
                      <h5 className="mb-3 flex items-center space-x-2 text-sm font-semibold text-primary">
                        <svg className="w-4 h-4 brand-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <span>执行设置</span>
                      </h5>

                      {/* 自动编队 */}
                      <div className="mb-3 space-y-1.5">
                        <div className="flex items-center space-x-2">
                          <label className="w-12 shrink-0 text-xs text-secondary">编队</label>
                          <select
                            value={getFormationMode(task.id)}
                            onChange={(e) => setAutoFormation({ ...autoFormation, [task.id]: e.target.value as FormationMode })}
                            className="min-w-0 flex-1 rounded-lg border border-[var(--app-border)] px-2 py-1.5 text-xs text-primary control-surface focus:outline-none focus:ring-1 focus:ring-[var(--app-accent)]"
                          >
                            <option value="auto">跟随 CLI</option>
                            <option value="on">强制自动编队</option>
                            <option value="off">不传编队参数</option>
                          </select>
                        </div>
                        <p className="pl-14 text-[11px] leading-relaxed text-tertiary">
                          作业集拆分执行时，“跟随 CLI”会自动启用编队；单作业按 maa-cli 默认处理。
                        </p>
                      </div>

                      {/* 突袭模式 */}
                      <div className="mb-3 flex items-center space-x-2">
                        <label className="w-12 shrink-0 text-xs text-secondary">模式</label>
                        <select
                          value={normalizeRaidValue(advancedParams[task.id]?.raid)}
                          onChange={(e) => handleAdvancedChange(task.id, 'raid', e.target.value)}
                          className="min-w-0 flex-1 rounded-lg border border-[var(--app-border)] px-2 py-1.5 text-xs text-primary control-surface focus:outline-none focus:ring-1 focus:ring-[var(--app-accent)]"
                        >
                          <option value="normal">普通模式</option>
                          <option value="raid">突袭模式</option>
                          <option value="both">普通+突袭</option>
                        </select>
                      </div>

                      {/* 作业集执行方式 */}
                      <div className="space-y-1.5">
                        <div className="flex items-center space-x-2">
                          <label className="w-12 shrink-0 text-xs text-secondary">作业集</label>
                          <select
                            value={copilotSetExecutionMode}
                            onChange={(e) => setCopilotSetExecutionMode(e.target.value as CopilotSetExecutionMode)}
                            className="min-w-0 flex-1 rounded-lg border border-[var(--app-border)] px-2 py-1.5 text-xs text-primary control-surface focus:outline-none focus:ring-1 focus:ring-[var(--app-accent)]"
                          >
                            <option value="app">应用内连续</option>
                            <option value="manual">手动逐关</option>
                            <option value="cli">CLI 原生连续</option>
                          </select>
                        </div>
                        <p className="pl-14 text-[11px] leading-relaxed text-tertiary">
                          应用内连续会保存断点：成功项自动移出待执行，失败项保留待重试。
                        </p>
                      </div>

                      {/* 高级选项 */}
                      {task.hasAdvanced && (
                        <details className="mt-4 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] px-3 py-2">
                          <summary className="cursor-pointer list-none text-sm font-medium text-secondary">
                            高级设置
                          </summary>
                          {renderAdvancedOptions(task)}
                        </details>
                      )}
                    </div>
                  </div>

                  {/* 中栏：输入框 + 作业列表 */}
                  <div className="flex min-w-0 flex-col space-y-3">
                    <div className="rounded-lg border border-[var(--app-border)] p-2 surface-soft">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          name="maa-copilot-uri"
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          inputMode="url"
                          placeholder="maa://1234、maa://1234s、作业站链接或本地路径"
                          value={taskInputs[task.id] || ''}
                          onChange={(e) => handleInputChange(task.id, e.target.value)}
                          className="min-w-0 flex-1 rounded-lg border border-transparent px-3 py-2 font-mono text-sm text-primary control-surface focus:border-[var(--app-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--app-accent-soft)]"
                        />
                        <Button
                          onClick={() => handlePreviewCopilotSetWithInput()}
                          disabled={isLoadingSet || !taskInputs[task.id]?.trim()}
                          loading={isLoadingSet}
                          variant="secondary"
                          size="md"
                          className="shrink-0 px-3"
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
                      <div className="mt-2 flex items-center justify-between gap-3 px-1 text-xs text-tertiary">
                        <p className="truncate">支持作业 URI、作业站链接、HTTP(S) JSON 和本地 JSON 路径。</p>
                        <details className="relative shrink-0">
                          <summary className="cursor-pointer list-none brand-text hover:underline">说明</summary>
                          <div className="absolute z-20 mt-2 w-72 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-solid)] p-3 text-left shadow-lg space-y-1.5">
                            <p>• 访问 <a href="https://zoot.plus/" target="_blank" rel="noopener noreferrer" className="brand-text hover:underline">zoot.plus</a> 获取作业 URI</p>
                            <p>• 单作业：<code className="px-1 bg-gray-100 dark:bg-gray-800 rounded">maa://1234</code>；作业集：<code className="px-1 bg-gray-100 dark:bg-gray-800 rounded">maa://1234s</code></p>
                            <p>• 作业站链接会自动提取 ID，也支持远程 JSON 和本地路径</p>
                          </div>
                        </details>
                      </div>
                    </div>

                    {/* 作业类型选择 */}
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium text-secondary">识别方式</span>
                      <div className="flex overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-0.5">
                        <button
                          onClick={() => setCopilotType('auto')}
                          className={`rounded-md px-3 py-1 transition-colors ${
                            copilotType === 'auto'
                              ? 'brand-action'
                              : 'text-secondary hover:bg-white/70 hover:text-primary dark:hover:bg-white/10'
                          }`}
                        >
                          自动
                        </button>
                        <button
                          onClick={() => setCopilotType('single')}
                          className={`rounded-md px-3 py-1 transition-colors ${
                            copilotType === 'single'
                              ? 'brand-action'
                              : 'text-secondary hover:bg-white/70 hover:text-primary dark:hover:bg-white/10'
                          }`}
                        >
                          单个作业
                        </button>
                        <button
                          onClick={() => setCopilotType('set')}
                          className={`rounded-md px-3 py-1 transition-colors ${
                            copilotType === 'set'
                              ? 'brand-action'
                              : 'text-secondary hover:bg-white/70 hover:text-primary dark:hover:bg-white/10'
                          }`}
                        >
                          作业集
                        </button>
                      </div>
                    </div>

                    {/* 作业列表 - 占据剩余空间 */}
                    <div className="flex min-h-[380px] flex-1 flex-col rounded-lg border border-[var(--app-border)] p-4 surface-soft">
                      <div className="flex items-center justify-between mb-3">
                        <h5 className="flex items-center space-x-2 text-sm font-semibold text-primary">
                          <svg className="w-4 h-4 brand-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                          </svg>
                          <span>作业列表</span>
                        </h5>
                        {copilotSetInfo?.type === 'set' && copilotSetInfo.copilots && !isRunning && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={resetCopilotSetProgress}
                              className="text-xs text-gray-500 dark:text-gray-400 hover:text-[var(--app-accent)] transition-colors"
                            >
                              重置进度
                            </button>
                            <span className="h-3 w-px bg-gray-200 dark:bg-white/10" />
                            <button
                              onClick={() => {
                                if (selectedCopilotIndexes.size === copilotSetInfo.copilots!.length) {
                                  applySelectedCopilotIndexes(new Set(), copilotSetInfo.id)
                                } else {
                                  applySelectedCopilotIndexes(new Set(copilotSetInfo.copilots!.map((_, idx) => idx)), copilotSetInfo.id)
                                }
                              }}
                              className="text-xs brand-text hover:underline transition-colors"
                            >
                              {selectedCopilotIndexes.size === copilotSetInfo.copilots.length ? '清空待执行' : '全选待执行'}
                            </button>
                          </div>
                        )}
                      </div>

                      {/* 作业集预览 */}
                      {copilotSetInfo?.type === 'set' && copilotSetInfo.copilots && copilotSetInfo.copilots.length > 0 ? (
                        <>
                          {(() => {
                            const total = copilotSetInfo.copilots.length
                            const pendingCount = selectedCopilotIndexes.size
                            const completedCount = total - pendingCount
                            const failedCount = copilotSetResults.filter(result => !result.success).length
                            const nextIndex = copilotSetInfo.copilots.findIndex((_, idx) => selectedCopilotIndexes.has(idx))
                            const nextCopilot = nextIndex >= 0 ? copilotSetInfo.copilots[nextIndex] : null
                            return (
                              <div className="mb-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-3">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                  <div className="min-w-0">
                                    <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-tertiary">续跑进度</div>
                                    <div className="mt-1 text-sm font-semibold text-primary">
                                      {nextCopilot ? `下次从第 ${nextIndex + 1} 关继续` : '作业集已完成'}
                                    </div>
                                    <div className="mt-1 truncate text-xs text-tertiary">
                                      {copilotSetResults.length > 0 ? `本次已执行 ${copilotSetResults.length} 个` : `共 ${total} 个作业`}
                                    </div>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-1.5">
                                    <span className="rounded-md px-2 py-1 text-[11px] brand-chip">待 {pendingCount}</span>
                                    <span className="rounded-md border border-[var(--app-border)] px-2 py-1 text-[11px] text-secondary">完成 {completedCount}</span>
                                    <span className={`rounded-md border px-2 py-1 text-[11px] ${failedCount > 0 ? 'border-rose-400/30 bg-rose-500/10 text-rose-500 dark:text-rose-300' : 'border-[var(--app-border)] text-secondary'}`}>失败 {failedCount}</span>
                                  </div>
                                </div>
                                <div className="mt-3">
                                  <div className="h-1.5 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                                    <div
                                      className="h-full bg-[var(--app-accent)] transition-all duration-300"
                                      style={{ width: `${total > 0 ? (completedCount / total) * 100 : 0}%` }}
                                    />
                                  </div>
                                  {nextCopilot ? (
                                    <div className="mt-2 flex min-w-0 items-center gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2 text-xs">
                                      <span className="shrink-0 text-tertiary">续跑目标</span>
                                      <span className="font-mono brand-text">maa://{nextCopilot.id}</span>
                                      <span className="min-w-0 truncate text-secondary">{nextCopilot.stage || nextCopilot.name || `第 ${nextIndex + 1} 关`}</span>
                                    </div>
                                  ) : (
                                    <div className="mt-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2 text-xs text-tertiary">
                                      需要重打时点击“重置进度”。
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          })()}

                          {/* 当前作业卡片 */}
                          {(() => {
                            const currentCopilot = copilotSetInfo.currentIndex !== undefined
                              ? copilotSetInfo.copilots[copilotSetInfo.currentIndex]
                              : null
                            return waitingForNextCopilot && currentCopilot && (
                              <div className="mb-3 rounded-lg border border-[var(--app-accent)] bg-[var(--app-accent-soft)] p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center space-x-2">
                                    <span className="px-2 py-0.5 brand-action text-xs font-medium rounded">下一关</span>
                                    <span className="text-xs brand-text">第 {(copilotSetInfo.currentIndex ?? 0) + 1} / {copilotSetInfo.copilots.length} 关</span>
                                  </div>
                                  <span className="font-mono text-xs brand-text">maa://{currentCopilot.id}</span>
                                </div>
                                <p className="text-sm font-medium text-primary">{currentCopilot.name || `作业 #${currentCopilot.id}`}</p>
                                {currentCopilot.stage && <p className="text-xs text-secondary">{currentCopilot.stage}</p>}

                                <div className="mt-3 pt-3 border-t border-[var(--app-border)]">
                                  <p className="text-xs brand-text mb-2">请在游戏中进入下一关界面后点击继续</p>
                                  <div className="flex space-x-2">
                                    <Button onClick={handleStartNextCopilot} variant="gradient" size="md" fullWidth>
                                      开始下一关
                                    </Button>
                                    <Button onClick={handleCancelCopilotSet} variant="secondary" size="md">取消</Button>
                                  </div>
                                </div>
                              </div>
                            )
                          })()}

                          {/* 作业列表 */}
                          <div className="flex-1 space-y-1 overflow-y-auto pr-1">
                            {copilotSetInfo.copilots.map((copilot, idx) => {
                              const isCompleted = copilotSetResults.some(r => r.index === idx)
                              const isSuccess = copilotSetResults.find(r => r.index === idx)?.success
                              const isCurrent = copilotSetInfo.currentIndex === idx && isRunning
                              const isSelected = selectedCopilotIndexes.has(idx)
                              const isPersistedDone = !isSelected && !isCompleted
                              const statusLabel = isCurrent
                                ? '执行中'
                                : isCompleted
                                  ? (isSuccess ? '已完成' : '待重试')
                                  : isPersistedDone
                                    ? '已完成/跳过'
                                    : '待执行'

                              const handleToggleSelect = () => {
                                const newSet = new Set(selectedCopilotIndexes)
                                if (newSet.has(idx)) {
                                  newSet.delete(idx)
                                } else {
                                  newSet.add(idx)
                                }
                                applySelectedCopilotIndexes(newSet, copilotSetInfo.id)
                              }

                              return (
                                <div key={`${copilot.id}-${idx}`} className={`flex items-center justify-between gap-3 rounded-lg border px-2.5 py-2 text-xs transition-colors ${
                                  isCurrent ? 'brand-action-subtle border-[var(--app-accent)]' :
                                  isCompleted ? (isSuccess ? 'border-emerald-500/20 bg-emerald-500/10' : 'border-rose-500/25 bg-rose-500/10') :
                                  isPersistedDone ? 'border-[var(--app-border)] bg-black/[0.025] opacity-70 dark:bg-white/[0.035]' :
                                  'border-[var(--app-border)] bg-[var(--app-surface)] hover:border-[var(--app-border-strong)]'
                                }`}>
                                  <div className="flex min-w-0 items-center space-x-2">
                                    {/* 勾选框 */}
                                    <button
                                      onClick={handleToggleSelect}
                                      disabled={isRunning}
                                      className={`flex h-4 w-4 items-center justify-center rounded border transition-all ${
                                        isSelected
                                          ? 'bg-[var(--app-accent)] border-[var(--app-accent)] text-white'
                                          : 'border-[var(--app-border-strong)] bg-[var(--app-surface-solid)]'
                                      } ${isRunning ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-[var(--app-accent)]'}`}
                                    >
                                      {isSelected && (
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                        </svg>
                                      )}
                                    </button>
                                    <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                                      isCurrent ? 'bg-[var(--app-accent)] text-white animate-pulse' :
                                      isCompleted ? (isSuccess ? 'bg-[var(--app-success)] text-white' : 'bg-[var(--app-danger)] text-white') :
                                      isPersistedDone ? 'bg-black/10 text-tertiary dark:bg-white/10' :
                                      'bg-black/5 text-secondary dark:bg-white/10'
                                    }`}>
                                      {isCompleted ? (isSuccess ? '✓' : '✗') : isPersistedDone ? '✓' : idx + 1}
                                    </span>
                                    <div className="min-w-0">
                                      <div className="flex min-w-0 items-center gap-1.5">
                                        <span className="truncate text-primary">{copilot.name || `作业 #${copilot.id}`}</span>
                                        {copilot.presetFormation && (
                                          <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] brand-chip">预设编队 · 仅普通</span>
                                        )}
                                        {copilot.completedModes?.map(mode => (
                                          <span key={mode} className="shrink-0 rounded px-1.5 py-0.5 text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                                            {mode === 'raid' ? '突袭已完成' : '普通已完成'}
                                          </span>
                                        ))}
                                      </div>
                                      {copilot.stage && <div className="mt-0.5 truncate text-[11px] text-tertiary">{copilot.stage}</div>}
                                    </div>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-2">
                                    <span className={`min-w-[64px] rounded-md px-2 py-0.5 text-center text-[11px] ${
                                      isCurrent ? 'brand-action text-white' :
                                      isCompleted && !isSuccess ? 'bg-rose-500/10 text-rose-500 dark:text-rose-300' :
                                      isSelected ? 'brand-chip' :
                                      'bg-black/5 text-secondary dark:bg-white/10'
                                    }`}>
                                      {statusLabel}
                                    </span>
                                    <span className="hidden font-mono text-tertiary 2xl:inline">maa://{copilot.id}</span>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </>
                      ) : copilotSetInfo?.type === 'single' ? (
                        <div className="flex-1 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-3">
                          <div className="flex items-center space-x-2 mb-1">
                            <span className="rounded-md px-2 py-0.5 text-xs font-medium brand-chip">单个作业</span>
                            <span className="text-xs text-tertiary">ID: {copilotSetInfo.id}</span>
                          </div>
                          <p className="font-medium text-primary">{copilotSetInfo.name}</p>
                          <div className="mt-1 space-x-2 text-xs text-secondary">
                            {copilotSetInfo.stage && <span>关卡: {copilotSetInfo.stage}</span>}
                            {copilotSetInfo.operators && <span>干员: {copilotSetInfo.operators}</span>}
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-[var(--app-border)] py-10 text-center text-xs text-tertiary">
                          <svg className="w-12 h-12 mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <p>输入 maa:// 作业可预览</p>
                          <p className="mt-1">作业站链接会自动提取 ID，本地路径可直接执行</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 右栏：搜索框 + 作业介绍 */}
                  <div className="space-y-3 xl:sticky xl:top-24">
                    {/* 搜索框 */}
                    <div className="rounded-lg border border-[var(--app-border)] p-4 surface-soft">
                      <h5 className="mb-3 flex items-center space-x-2 text-sm font-semibold text-primary">
                        <svg className="w-4 h-4 brand-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                          className="min-w-0 flex-1 rounded-lg border border-[var(--app-border)] px-3 py-2 text-sm text-primary control-surface focus:outline-none focus:ring-2 focus:ring-[var(--app-accent-soft)]"
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
                      <p className="mt-2 text-xs text-tertiary">支持关卡代号或关卡名，例如 1-7、CE-6。</p>

                      {/* 搜索结果 */}
                      {copilotSearchResult && copilotSearchResult.copilots && (
                        <div className="mt-3 max-h-32 space-y-1 overflow-y-auto">
                          {copilotSearchResult.copilots.slice(0, 5).map((copilot, idx) => (
                            <button
                              key={copilot.id}
                              onClick={() => void applyCopilotUri(copilot.uri)}
                              className={`flex w-full items-center justify-between rounded-lg border px-3 py-1.5 text-left text-xs transition-all ${
                                selectedSearchCopilotUri === copilot.uri
                                  ? 'brand-action-subtle border-[var(--app-accent)]'
                                  : 'border-[var(--app-border)] bg-[var(--app-surface)] hover:border-[var(--app-accent)]'
                              }`}
                            >
                              <div className="flex items-center space-x-2">
                                <span className="font-mono brand-text">{copilot.uri}</span>
                                <span className="max-w-[80px] truncate text-secondary">{copilot.title}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                {selectedSearchCopilotUri === copilot.uri && (
                                  <span className="whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs brand-action">已选中</span>
                                )}
                                {idx === 0 && (
                                  <span className="whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs brand-chip">推荐</span>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 作业介绍 */}
                    <div className="rounded-lg border border-[var(--app-border)] p-4 surface-soft">
                      <h5 className="mb-3 flex items-center space-x-2 text-sm font-semibold text-primary">
                        <svg className="w-4 h-4 brand-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                                    <span className="rounded-md px-2 py-0.5 text-xs font-medium brand-chip">作业集</span>
                                    <span className="text-xs text-tertiary">已选 {selectedCount}/{total} 个</span>
                                  </div>

                                  {/* 当前进度 */}
                                  <div className="flex items-center space-x-2 text-xs">
                                    <span className="text-tertiary">进度</span>
                                    <span className="font-medium brand-text">
                                      {isRunning ? `第 ${currentIndex + 1} 关` : `${completed}/${selectedCount} 完成`}
                                    </span>
                                  </div>

                                  {/* 当前作业详情 */}
                                  {currentCopilot && (
                                    <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-2">
                                      <div className="flex items-center justify-between mb-1">
                                        <span className="text-xs text-tertiary">
                                          {isRunning ? '当前作业' : '下一作业'}
                                        </span>
                                        <span className="font-mono text-xs brand-text">
                                          maa://{currentCopilot.id}
                                        </span>
                                      </div>
                                      <p className="text-sm font-medium text-primary">
                                        {currentCopilot.name || `作业 #${currentCopilot.id}`}
                                      </p>
                                      {currentCopilot.stage && (
                                        <div className="mt-1 text-xs text-secondary">
                                          <span className="font-medium">关卡:</span> {currentCopilot.stage}
                                        </div>
                                      )}
                                      {currentCopilot.operators && (
                                        <div className="text-xs text-secondary">
                                          <span className="font-medium">干员:</span> {currentCopilot.operators}
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {copilotSetInfo.note && (
                                    <p className="text-xs text-tertiary">{copilotSetInfo.note}</p>
                                  )}
                                </>
                              )
                            })()
                          ) : (
                            <>
                              <div className="flex items-center space-x-2">
                                <span className="rounded-md px-2 py-0.5 text-xs font-medium brand-chip">单个作业</span>
                                <span className="text-xs text-tertiary">ID: {copilotSetInfo.id}</span>
                              </div>
                              <p className="text-sm font-medium text-primary">{copilotSetInfo.name}</p>
                              {copilotSetInfo.stage && (
                                <div className="text-xs text-secondary">
                                  <span className="font-medium">关卡:</span> {copilotSetInfo.stage}
                                </div>
                              )}
                              {copilotSetInfo.operators && (
                                <div className="text-xs text-secondary">
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
                        <div className="rounded-lg border border-dashed border-[var(--app-border)] py-6 text-center text-xs text-tertiary">
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

          {/* 保全派驻 / 悖论模拟 */}
          <div className="app-stack-section">
            {tasks.filter(task => task.id === activeCombatMode && task.id !== 'copilot').map((task) => {
              const taskUris = splitCopilotInputToArgs(taskInputs[task.id] || '')
              const isParadox = task.id === 'paradoxcopilot'
              const isSss = task.id === 'ssscopilot'
              const recommendedParadox = paradoxSearchResult?.copilots?.[0]

              return (
                <div
                  key={task.id}
                  className="rounded-xl border border-[var(--app-border)] p-5 surface-panel"
                >
                  <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg brand-action-subtle [&_*]:h-4 [&_*]:w-4">
                        {task.icon}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="truncate text-xl font-semibold tracking-tight text-primary">{task.name}</h4>
                          <span className="shrink-0 rounded-md border border-[var(--app-border)] px-2 py-0.5 font-mono text-[11px] text-tertiary">{task.command}</span>
                        </div>
                        <p className="mt-1 text-sm leading-relaxed text-secondary">{task.description}</p>
                      </div>
                    </div>

                    <Button
                      onClick={() => handleExecute(task)}
                      disabled={isRunning}
                      variant="gradient"
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

                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
                    <div className="min-w-0 space-y-4">
                      <div className="rounded-lg border border-[var(--app-border)] p-4 surface-soft">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <h5 className="flex items-center gap-2 text-sm font-semibold text-primary">
                            <svg className="h-4 w-4 brand-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span>作业输入</span>
                          </h5>
                          <span className={`shrink-0 rounded-md px-2 py-1 text-[11px] ${isSss && taskUris.length > 1 ? 'bg-rose-500/10 text-rose-500 dark:text-rose-300' : 'brand-chip'}`}>
                            {isSss ? `${taskUris.length}/1 URI` : `${taskUris.length} 个 URI`}
                          </span>
                        </div>
                        <textarea
                          name={`maa-${task.id}-uris`}
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          placeholder={
                            isSss
                              ? `${task.placeholder}\n一次只支持一个 SSS 作业 URI`
                              : `${task.placeholder}\n支持多行，每行一个作业 URI`
                          }
                          value={taskInputs[task.id] || ''}
                          onChange={(e) => handleInputChange(task.id, e.target.value)}
                          rows={isSss ? 4 : 5}
                          className="w-full resize-none rounded-lg border border-[var(--app-border)] px-4 py-3 font-mono text-sm font-medium text-primary control-surface focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--app-accent-soft)]"
                        />
                        {isSss && taskUris.length > 1 && (
                          <div className="mt-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-500 dark:text-rose-300">
                            保全派驻当前只会执行一个 SSS 作业 URI。
                          </div>
                        )}
                      </div>

                      {task.hasAdvanced && (
                        <div className="rounded-lg border border-[var(--app-border)] p-4 surface-soft">
                          <h5 className="mb-2 text-sm font-semibold text-primary">高级设置</h5>
                          {renderAdvancedOptions(task)}
                        </div>
                      )}
                    </div>

                    <div className="space-y-3 xl:sticky xl:top-24">
                      {isParadox ? (
                        <div className="rounded-lg border border-[var(--app-border)] p-4 surface-soft">
                          <h5 className="mb-3 flex items-center space-x-2 text-sm font-semibold text-primary">
                            <svg className="h-4 w-4 brand-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                            <span>干员搜索</span>
                          </h5>
                          <div className="flex space-x-2">
                            <input
                              type="text"
                              name="maa-paradox-operator"
                              autoComplete="off"
                              autoCorrect="off"
                              autoCapitalize="none"
                              spellCheck={false}
                              placeholder="古米、能天使"
                              value={paradoxSearchName}
                              onChange={(e) => setParadoxSearchName(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleSearchParadox()}
                              className="min-w-0 flex-1 rounded-lg border border-[var(--app-border)] px-3 py-2 text-sm text-primary control-surface focus:outline-none focus:ring-2 focus:ring-[var(--app-accent-soft)]"
                            />
                            <Button
                              onClick={handleSearchParadox}
                              disabled={isSearchingParadox || !paradoxSearchName.trim()}
                              loading={isSearchingParadox}
                              variant="secondary"
                              size="md"
                              className="shrink-0 px-3"
                            >
                              {!isSearchingParadox && '搜索'}
                            </Button>
                          </div>

                          {paradoxSearchResult && paradoxSearchResult.copilots && (
                            <div className="mt-3 space-y-2">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-medium brand-text">{paradoxSearchResult.operator}</span>
                                <span className="text-tertiary">{paradoxSearchResult.copilots.length} 个作业</span>
                              </div>
                              <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                                {paradoxSearchResult.copilots.slice(0, 6).map((copilot, idx) => {
                                  const stars = Math.min(5, Math.max(1, Math.ceil(copilot.hotScore)))

                                  return (
                                    <button
                                      key={copilot.id}
                                      onClick={() => {
                                        setTaskInputs({ ...taskInputs, paradoxcopilot: copilot.uri })
                                      }}
                                      className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2 text-left text-xs transition-all hover:border-[var(--app-accent)]"
                                    >
                                      <div className="flex min-w-0 items-center justify-between gap-2">
                                        <span className="truncate font-mono brand-text">{copilot.uri}</span>
                                        {idx === 0 && (
                                          <span className="shrink-0 rounded-md px-2 py-0.5 text-xs font-medium brand-chip">推荐</span>
                                        )}
                                      </div>
                                      <div className="mt-1 flex items-center space-x-2 text-secondary">
                                        <span>浏览 {copilot.views.toLocaleString()}</span>
                                        <span>/</span>
                                        <div className="flex items-center">
                                          {[...Array(stars)].map((_, i) => (
                                            <svg key={i} className="h-3 w-3 brand-text" fill="currentColor" viewBox="0 0 20 20">
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
                      ) : (
                        <div className="rounded-lg border border-[var(--app-border)] p-4 surface-soft">
                          <h5 className="mb-3 text-sm font-semibold text-primary">执行概览</h5>
                          <div className="space-y-2 text-xs">
                            <div className="flex items-center justify-between rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2">
                              <span className="text-tertiary">作业数量</span>
                              <span className={taskUris.length > 1 ? 'text-rose-500 dark:text-rose-300' : 'text-primary'}>{taskUris.length || 0}</span>
                            </div>
                            <div className="flex items-center justify-between rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2">
                              <span className="text-tertiary">循环次数</span>
                              <span className="text-primary">{advancedParams.ssscopilot?.loopTimes || '1'}</span>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="rounded-lg border border-[var(--app-border)] p-4 surface-soft">
                        <h5 className="mb-3 text-sm font-semibold text-primary">参数概览</h5>
                        <div className="space-y-2 text-xs">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-tertiary">命令</span>
                            <span className="font-mono brand-text">{task.command}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-tertiary">输入</span>
                            <span className="text-primary">{taskUris.length ? `${taskUris.length} 项` : '待填写'}</span>
                          </div>
                          {isParadox && (
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-tertiary">队列策略</span>
                              <span className="text-primary">
                                {advancedParams.paradoxcopilot?.executionStrategy === 'stop' ? '失败停止' : '失败继续'}
                              </span>
                            </div>
                          )}
                          {isParadox && recommendedParadox && (
                            <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2">
                              <div className="mb-1 text-tertiary">当前推荐</div>
                              <div className="truncate font-mono brand-text">{recommendedParadox.uri}</div>
                            </div>
                          )}
                        </div>
                      </div>
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
