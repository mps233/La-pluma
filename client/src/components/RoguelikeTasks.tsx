import { useState, useEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { maaApi } from '../services/api'
import Icons from './Icons'
import { PageHeader, Card, Input, Select, Checkbox, Button } from './common'
import { useStatusStore } from '../store/statusStore'
import FloatingStatusIndicator from './FloatingStatusIndicator'
import ScreenMonitor from './ScreenMonitor'
import { useFluidTabIndicator } from '../hooks/useFluidTabIndicator'
import { waitForTaskIdle } from '../utils/taskStatus'
import type {
  RoguelikeTask,
  RoguelikeAdvancedOption,
  RoguelikeTaskInputs,
  RoguelikeAdvancedParams
} from '@/types/components'
import { useAutomationAvailability } from '../hooks/useBackendStatusMonitor'

type RoguelikeMode = 'roguelike' | 'reclamation'

const THEME_PRESETS: Record<RoguelikeMode, Array<{ value: string; label: string }>> = {
  roguelike: [
    { value: 'Phantom', label: '傀影' },
    { value: 'Mizuki', label: '水月' },
    { value: 'Sami', label: '萨米' },
    { value: 'Sarkaz', label: '萨卡兹' },
    { value: 'JieGarden', label: '界园' },
  ],
  reclamation: [
    { value: 'Tales', label: '沙洲遗闻' },
  ],
}

export default function RoguelikeTasks() {
  const shouldReduceMotion = useReducedMotion()
  const [isRunning, setIsRunning] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const stopRequestInFlightRef = useRef(false)
  const stopRequestedRef = useRef(false)
  const executionGenerationRef = useRef(0)
  const stopWaitControllerRef = useRef<AbortController | null>(null)
  const { setMessage: setStatusMessage, setActive: setIsActiveStatus } = useStatusStore()
  const { isAvailable: automationAvailable, unavailableMessage } = useAutomationAvailability()
  const [taskInputs, setTaskInputs] = useState<RoguelikeTaskInputs>({})
  const [advancedParams, setAdvancedParams] = useState<RoguelikeAdvancedParams>({})
  const [configLoaded, setConfigLoaded] = useState(false)
  const [activeMode, setActiveMode] = useState<RoguelikeMode>('roguelike')
  const { containerRef: modeTabsRef, activeRect: activeModeRect, setTabRef: setModeTabRef } = useFluidTabIndicator(activeMode)

  useEffect(() => {
    setIsActiveStatus(isRunning)
  }, [isRunning, setIsActiveStatus])

  useEffect(() => () => {
    executionGenerationRef.current += 1
    stopWaitControllerRef.current?.abort()
  }, [])

  const beginExecution = () => {
    stopWaitControllerRef.current?.abort()
    stopWaitControllerRef.current = null
    stopRequestedRef.current = false
    stopRequestInFlightRef.current = false
    setIsStopping(false)
    setIsRunning(true)
    executionGenerationRef.current += 1
    return executionGenerationRef.current
  }

  const isCurrentExecution = (generation: number) =>
    executionGenerationRef.current === generation && !stopRequestedRef.current

  // 页面加载时从服务器或 localStorage 加载配置和恢复执行状态
  useEffect(() => {
    let cancelled = false
    let pollInterval: ReturnType<typeof setInterval> | null = null
    let pollFailures = 0
    let pollRequestInFlight = false
    const controller = new AbortController()

    const stopStatusPolling = () => {
      if (!pollInterval) return
      clearInterval(pollInterval)
      pollInterval = null
    }

    // 从后端获取真实的任务执行状态
    const checkBackendStatus = async () => {
      try {
        const result = await maaApi.getTaskStatus(controller.signal)
        if (cancelled) return
        const taskStatus = result.data
        if (result.success && taskStatus?.isRunning) {
          // 后端确实有任务在运行
          const { taskName, startTime, taskType } = taskStatus
          
          // 只恢复属于肉鸽模式的任务
          if (taskType === 'roguelike') {
            const elapsedMinutes = (Date.now() - startTime) / 1000 / 60
            setIsRunning(true)
            if (elapsedMinutes > 5) {
              setStatusMessage(`${taskName} 可能已完成（已运行 ${Math.floor(elapsedMinutes)} 分钟）`)
            } else {
              setStatusMessage(`正在执行: ${taskName}`)
            }
            
            // 启动轮询，持续检查任务状态
            pollInterval = setInterval(async () => {
              if (pollRequestInFlight) return
              pollRequestInFlight = true
              try {
                const statusResult = await maaApi.getTaskStatus(controller.signal)
                if (cancelled) return
                if (statusResult.success && !statusResult.data.isRunning) {
                  // 任务已完成
                  setIsRunning(false)
                  setStatusMessage('任务已完成')
                  stopStatusPolling()
                } else if (statusResult.success) {
                  pollFailures = 0
                }
              } catch (error) {
                if (cancelled || (error instanceof Error && error.name === 'AbortError')) return
                pollFailures += 1
                if (pollFailures === 3) {
                  setStatusMessage('暂时无法确认肉鸽任务状态，将继续重试；需要时可手动终止', 'warning')
                }
              } finally {
                pollRequestInFlight = false
              }
            }, 2000) // 每2秒检查一次
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
        const serverConfig = await maaApi.loadUserConfig('roguelike-tasks')
        if (serverConfig.success && serverConfig.data) {
          const { taskInputs: inputs, advancedParams: advanced } = serverConfig.data
          if (inputs) {
            setTaskInputs(inputs)
            localStorage.setItem('roguelikeTaskInputs', JSON.stringify(inputs))
          }
          if (advanced) {
            setAdvancedParams(advanced)
            localStorage.setItem('roguelikeAdvancedParams', JSON.stringify(advanced))
          }
          return
        }
      } catch (error) {
        // 静默失败，从 localStorage 加载
      }
      
      // 服务器加载失败，从 localStorage 加载
      const savedInputs = localStorage.getItem('roguelikeTaskInputs')
      const savedAdvanced = localStorage.getItem('roguelikeAdvancedParams')
      
      if (savedInputs) {
        setTaskInputs(JSON.parse(savedInputs))
      }
      if (savedAdvanced) {
        setAdvancedParams(JSON.parse(savedAdvanced))
      }
    }
    
    void loadConfig().finally(() => {
      if (!cancelled) setConfigLoaded(true)
    })

    return () => {
      cancelled = true
      controller.abort()
      stopStatusPolling()
    }
  }, [setStatusMessage])

  // 自动保存配置
  useEffect(() => {
    if (!configLoaded) return

    localStorage.setItem('roguelikeTaskInputs', JSON.stringify(taskInputs))
    localStorage.setItem('roguelikeAdvancedParams', JSON.stringify(advancedParams))
    const saveTimer = window.setTimeout(() => {
      maaApi.saveUserConfig('roguelike-tasks', { taskInputs, advancedParams }).catch(() => {
        // 静默失败，不影响用户体验
      })
    }, 300)

    return () => window.clearTimeout(saveTimer)
  }, [advancedParams, configLoaded, taskInputs])

  const tasks: RoguelikeTask[] = [
    { 
      id: 'roguelike', 
      name: '集成战略', 
      command: 'roguelike', 
      placeholder: '输入主题代号',
      icon: 'Map', 
      hasAdvanced: true,
      description: '自动刷集成战略（肉鸽），支持多个主题'
    },
    { 
      id: 'reclamation', 
      name: '生息演算', 
      command: 'reclamation', 
      placeholder: '输入主题代号',
      icon: 'Plant', 
      hasAdvanced: true,
      description: '自动生息演算模式'
    },
  ]

  const getAdvancedOptions = (taskId: string): RoguelikeAdvancedOption[] => {
    const options: Record<string, RoguelikeAdvancedOption[]> = {
      roguelike: [
        { key: 'mode', label: '模式', type: 'select', param: '--mode', options: [
          { value: '0', label: '刷分模式' },
          { value: '1', label: '刷源石锭' },
          { value: '4', label: '3层后退出' },
        ]},
        { key: 'squad', label: '起始分队', type: 'text', param: '--squad', placeholder: '指挥分队' },
        { key: 'coreChar', label: '核心干员', type: 'text', param: '--core-char', placeholder: '维什戴尔' },
        { key: 'startCount', label: '运行次数', type: 'number', param: '--start-count', placeholder: '无限' },
        { key: 'useSupport', label: '使用助战', type: 'checkbox', param: '--use-support' },
        { key: 'stopAtBoss', label: '最终Boss前停止', type: 'checkbox', param: '--stop-at-final-boss' },
      ],
      reclamation: [
        { key: 'mode', label: '模式', type: 'select', param: '-m', options: [
          { value: '0', label: '刷繁荣度（无存档）' },
          { value: '1', label: '制作工具刷繁荣度' },
        ]},
        { key: 'toolsToCraft', label: '制作工具名称', type: 'text', param: '-C', placeholder: '荧光棒' },
        { key: 'numBatches', label: '批次数', type: 'number', param: '--num-craft-batches', placeholder: '16' },
      ],
    }
    return options[taskId] || []
  }

  const buildCommandParams = (task: RoguelikeTask): string => {
    let params = taskInputs[task.id] || ''
    
    const advanced = advancedParams[task.id] || {}
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

  const handleExecute = async (task: RoguelikeTask) => {
    if (!automationAvailable) {
      setStatusMessage(unavailableMessage, 'error')
      return
    }

    // 验证输入
    const inputValue = taskInputs[task.id] || ''
    if (task.id === 'roguelike' || task.id === 'reclamation') {
      if (!inputValue.trim()) {
        setStatusMessage('请输入主题名称')
        return
      }
    }

    const generation = beginExecution()
    setStatusMessage('正在执行命令...')

    try {
      const params = buildCommandParams(task)
      const result = await maaApi.executePredefinedTask(task.command, params, null, null, task.name, 'roguelike', true)

      if (!isCurrentExecution(generation)) return
      if (result.success) {
        setStatusMessage(`${task.name} 执行成功`, 'success')
      } else {
        setStatusMessage(`执行失败: ${maaApi.getErrorMessage(result)}`, 'error')
      }
    } catch (error) {
      if (!isCurrentExecution(generation)) return
      setStatusMessage(`网络错误: ${(error as Error).message}`, 'error')
    } finally {
      if (isCurrentExecution(generation)) {
        stopRequestedRef.current = false
        setIsRunning(false)
        stopRequestInFlightRef.current = false
        setIsStopping(false)
      }
    }
  }

  const handleStopTask = async () => {
    if (!isRunning || stopRequestInFlightRef.current) return

    const activeGeneration = executionGenerationRef.current
    let operationGeneration = activeGeneration
    let waitController: AbortController | null = null
    stopRequestedRef.current = true
    stopRequestInFlightRef.current = true
    setIsStopping(true)
    setStatusMessage('正在终止肉鸽任务...', 'warning')

    try {
      const result = await maaApi.stopTask()
      if (executionGenerationRef.current !== activeGeneration) return
      const taskStopped = Boolean(result.data?.task?.success)
      if (!result.success || !taskStopped) {
        throw new Error(result.data?.task?.message || result.message || '当前任务未能终止')
      }

      executionGenerationRef.current += 1
      operationGeneration = executionGenerationRef.current
      stopWaitControllerRef.current?.abort()
      waitController = new AbortController()
      stopWaitControllerRef.current = waitController
      const confirmedIdle = await waitForTaskIdle(maaApi.getTaskStatus.bind(maaApi), { signal: waitController.signal })
      if (waitController.signal.aborted || executionGenerationRef.current !== operationGeneration) return
      if (!confirmedIdle) {
        throw new Error('终止请求已发送，但尚未确认任务停止')
      }

      stopRequestedRef.current = false
      setIsRunning(false)
      setStatusMessage('肉鸽任务已终止', 'warning')
    } catch (error) {
      if (waitController?.signal.aborted || executionGenerationRef.current !== operationGeneration) return
      stopRequestedRef.current = false
      setStatusMessage(`终止失败: ${(error as Error).message}`, 'error')
    } finally {
      if (stopWaitControllerRef.current === waitController) stopWaitControllerRef.current = null
      if (executionGenerationRef.current === operationGeneration) {
        stopRequestInFlightRef.current = false
        setIsStopping(false)
      }
    }
  }

  const handleInputChange = (taskId: string, value: string) => {
    setTaskInputs({ ...taskInputs, [taskId]: value })
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

  const renderAdvancedOptions = (task: RoguelikeTask) => {
    const options = getAdvancedOptions(task.id)
    if (options.length === 0) return null
    
    const advanced = advancedParams[task.id] || {}
    
    const fieldOptions = options.filter(option => option.type !== 'checkbox')
    const toggleOptions = options.filter(option => option.type === 'checkbox')

    return (
      <>
        <div className="roguelike-field-grid">
          {fieldOptions.map(option => (
            <div key={option.key}>
              {option.type === 'select' && option.options ? (
                <Select
                  label={option.label}
                  value={String(advanced[option.key] ?? option.options[0]?.value ?? '')}
                  onChange={(value: string) => handleAdvancedChange(task.id, option.key, value)}
                  options={option.options}
                />
              ) : (
                <Input
                  type={option.type === 'number' ? 'number' : 'text'}
                  label={option.label}
                  value={advanced[option.key] as string | number ?? ''}
                  onChange={(value: string) => handleAdvancedChange(task.id, option.key, value)}
                  placeholder={option.placeholder}
                />
              )}
            </div>
          ))}
        </div>
        {toggleOptions.length > 0 && (
          <div className="roguelike-toggle-list">
            {toggleOptions.map(option => (
              <div key={option.key} className="roguelike-toggle-row">
                <Checkbox
                  checked={advanced[option.key] as boolean || false}
                  onChange={(checked: boolean) => handleAdvancedChange(task.id, option.key, checked)}
                  label={option.label}
                />
              </div>
            ))}
          </div>
        )}
      </>
    )
  }

  const activeTask = tasks.find(task => task.id === activeMode) ?? tasks[0]
  if (!activeTask) return null
  const ActiveIcon = Icons[activeTask.icon as keyof typeof Icons]
  const activeTheme = taskInputs[activeTask.id] || ''

  return (
    <div className="app-page app-stack-section roguelike-page">
      <PageHeader
        icon={<Icons.DiceIcon />}
        title="肉鸽模式"
        subtitle="集成战略与生息演算配置"
        actions={<FloatingStatusIndicator />}
      />

      <div className="task-monitor-layout">
        <div className="task-monitor-main">
      <div className="roguelike-mode-shell">
        <div ref={modeTabsRef} className="roguelike-mode-tabs">
          {activeModeRect.width > 0 && (
            <motion.div
              data-testid="roguelike-mode-highlight"
              aria-hidden="true"
              className="roguelike-mode-highlight"
              initial={false}
              animate={{
                x: activeModeRect.x,
                y: activeModeRect.y,
                width: activeModeRect.width,
                height: activeModeRect.height,
              }}
              transition={shouldReduceMotion
                ? { duration: 0 }
                : { type: 'spring', stiffness: 360, damping: 34, mass: 0.8 }}
            >
              {ActiveIcon && <span className="roguelike-mode-icon is-active"><ActiveIcon /></span>}
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{activeTask.name}</span>
                <span className="roguelike-mode-description">{activeTask.description}</span>
              </span>
            </motion.div>
          )}
          {tasks.map(task => {
            const IconComponent = Icons[task.icon as keyof typeof Icons]
            const selected = activeMode === task.id
            return (
              <button
                key={task.id}
                ref={(element) => {
                  setModeTabRef(task.id as RoguelikeMode)(element)
                }}
                type="button"
                onClick={() => setActiveMode(task.id as RoguelikeMode)}
                aria-pressed={selected}
                className={`roguelike-mode-button ${selected ? 'is-selected' : ''}`}
              >
                {IconComponent && <span className="roguelike-mode-icon"><IconComponent /></span>}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{task.name}</span>
                  <span className="mt-0.5 block truncate text-xs text-tertiary">{task.description}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <Card className="roguelike-workspace" animated>
        <div className="roguelike-workspace-header">
          <div className="roguelike-workspace-heading">
            {ActiveIcon && <span className="roguelike-workspace-icon"><ActiveIcon /></span>}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold text-primary">{activeTask.name}</h3>
                <span className="roguelike-command-chip">{activeTask.command}</span>
              </div>
              <p className="mt-1 text-sm text-secondary">{activeTask.description}</p>
            </div>
          </div>
          {isRunning ? (
            <Button
              onClick={handleStopTask}
              disabled={isStopping}
              loading={isStopping}
              loadingText="正在终止"
              variant="danger"
              size="md"
              icon={<span className="h-3 w-3 rounded-[2px] bg-current" aria-hidden="true" />}
              className="roguelike-run-button"
            >
              终止执行
            </Button>
          ) : (
            <Button
              onClick={() => handleExecute(activeTask)}
              disabled={!automationAvailable}
              title={!automationAvailable ? unavailableMessage : undefined}
              variant="primary"
              size="md"
              icon={
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                </svg>
              }
              className="roguelike-run-button"
            >
              立即执行
            </Button>
          )}
        </div>

        <div className="roguelike-workspace-grid">
          <section className="roguelike-workspace-section">
            <div className="roguelike-section-heading">
              <span>主题</span>
              <small>{THEME_PRESETS[activeMode].length} 个可用</small>
            </div>
            <div className="roguelike-theme-grid">
              {THEME_PRESETS[activeMode].map(theme => (
                <button
                  key={theme.value}
                  type="button"
                  onClick={() => handleInputChange(activeTask.id, theme.value)}
                  aria-pressed={activeTheme === theme.value}
                  className={`roguelike-theme-option ${activeTheme === theme.value ? 'is-active' : ''}`}
                >
                  <span>{theme.label}</span>
                  <small>{theme.value}</small>
                </button>
              ))}
            </div>
            <Input
              type="text"
              label="自定义主题代号"
              placeholder={activeTask.placeholder}
              value={activeTheme}
              onChange={(value: string) => handleInputChange(activeTask.id, value)}
              className="roguelike-custom-theme"
            />
          </section>

          <section className="roguelike-workspace-section is-settings">
            <div className="roguelike-section-heading">
              <span>策略设置</span>
              <small>{getAdvancedOptions(activeTask.id).length} 项</small>
            </div>
            {renderAdvancedOptions(activeTask)}
          </section>
        </div>
      </Card>
        </div>

        <aside className="task-monitor-column" aria-label="模拟器实时预览">
          <div className="task-monitor-panel is-compact surface-panel">
            <ScreenMonitor variant="compact" />
          </div>
        </aside>
      </div>
    </div>
  )
}
