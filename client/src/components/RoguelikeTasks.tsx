import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Check, Play, Square } from 'lucide-react'
import { maaApi } from '../services/api'
import Icons from './Icons'
import { PageHeader, Input, Select, Button, SmoothPanel, Switch } from './common'
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
type RoguelikeUserConfig = {
  taskInputs: RoguelikeTaskInputs
  advancedParams: RoguelikeAdvancedParams
}

const ROGUELIKE_CONFIG_SYNC_PENDING_KEY = 'roguelikeConfigSyncPending'
let roguelikeConfigSyncSequence = 0
let roguelikeConfigSyncQueue: Promise<void> = Promise.resolve()

const createRoguelikeConfigSyncToken = () => `${Date.now()}-${++roguelikeConfigSyncSequence}`
const enqueueRoguelikeConfigSync = <T,>(operation: () => Promise<T>) => {
  const result = roguelikeConfigSyncQueue.then(operation, operation)
  roguelikeConfigSyncQueue = result.then(() => undefined, () => undefined)
  return result
}

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
  const [configSyncError, setConfigSyncError] = useState<string | null>(null)
  const [isRetryingConfigSave, setIsRetryingConfigSave] = useState(false)
  const configRevisionRef = useRef(0)
  const skippedInitialConfigSaveRef = useRef(false)
  const lastQueuedConfigFingerprintRef = useRef<string | null>(null)
  const configHydratedRef = useRef(false)
  const [activeMode, setActiveMode] = useState<RoguelikeMode>('roguelike')
  const {
    containerRef: modeTabsRef,
    activeRect: activeModeRect,
    setTabRef: setModeTabRef,
    handleTabKeyDown: handleModeKeyDown,
  } = useFluidTabIndicator(activeMode)

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
    setIsActiveStatus(true)
    executionGenerationRef.current += 1
    return executionGenerationRef.current
  }

  const isCurrentExecution = (generation: number) =>
    executionGenerationRef.current === generation && !stopRequestedRef.current

  const syncConfig = useCallback((
    config: RoguelikeUserConfig,
    revision: number,
    syncToken: string,
    announceSuccess = false,
  ) => enqueueRoguelikeConfigSync(async () => {
    if (
      revision !== configRevisionRef.current
      || localStorage.getItem(ROGUELIKE_CONFIG_SYNC_PENDING_KEY) !== syncToken
    ) return false

    try {
      const result = await maaApi.saveUserConfig('roguelike-tasks', config)
      if (!result.success) throw new Error(maaApi.getErrorMessage(result))
      if (
        revision !== configRevisionRef.current
        || localStorage.getItem(ROGUELIKE_CONFIG_SYNC_PENDING_KEY) !== syncToken
      ) return false

      localStorage.removeItem(ROGUELIKE_CONFIG_SYNC_PENDING_KEY)
      setConfigSyncError(null)
      if (announceSuccess) setStatusMessage('肉鸽配置已同步', 'success')
      return true
    } catch (error) {
      if (
        revision !== configRevisionRef.current
        || localStorage.getItem(ROGUELIKE_CONFIG_SYNC_PENDING_KEY) !== syncToken
      ) return false

      const detail = error instanceof Error && error.message ? error.message : '暂时无法连接服务器'
      setConfigSyncError(`配置已保存在此设备，但尚未同步到服务器：${detail}`)
      return false
    }
  }), [setStatusMessage])

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
        if (result.success) {
          const backendRunning = Boolean(taskStatus?.isRunning)
          setIsActiveStatus(backendRunning)

          if (!backendRunning || taskStatus?.taskType !== 'roguelike') {
            setIsRunning(false)
            return
          }

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
                if (statusResult.success) {
                  setIsActiveStatus(Boolean(statusResult.data?.isRunning))
                }
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
    
    void checkBackendStatus()

    const cleanup = () => {
      cancelled = true
      controller.abort()
      stopStatusPolling()
    }

    if (configHydratedRef.current) return cleanup
    
    const loadLocalConfig = () => {
      let restored = false
      const restoreJson = <T,>(key: string, apply: (value: T) => void) => {
        const stored = localStorage.getItem(key)
        if (!stored) return
        try {
          apply(JSON.parse(stored) as T)
          restored = true
        } catch {
          localStorage.removeItem(key)
        }
      }

      restoreJson<RoguelikeTaskInputs>('roguelikeTaskInputs', setTaskInputs)
      restoreJson<RoguelikeAdvancedParams>('roguelikeAdvancedParams', setAdvancedParams)
      return restored
    }

    // A pending local draft is newer than the server copy by definition.
    const hasPendingLocalDraft = localStorage.getItem(ROGUELIKE_CONFIG_SYNC_PENDING_KEY) !== null
    if (hasPendingLocalDraft) {
      if (loadLocalConfig()) {
        configHydratedRef.current = true
        setConfigSyncError('上次更改已保存在此设备，但尚未同步到服务器。')
        setConfigLoaded(true)
        return cleanup
      }
      localStorage.removeItem(ROGUELIKE_CONFIG_SYNC_PENDING_KEY)
    }

    // 加载保存的配置 - 优先从服务器加载
    const loadConfig = async () => {
      try {
        const serverConfig = await maaApi.loadUserConfig('roguelike-tasks')
        if (cancelled) return
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
        if (cancelled) return
        // 静默失败，从 localStorage 加载
      }

      if (!cancelled) loadLocalConfig()
    }
    
    void loadConfig().finally(() => {
      if (!cancelled) {
        configHydratedRef.current = true
        setConfigLoaded(true)
      }
    })

    return cleanup
  }, [setIsActiveStatus, setStatusMessage])

  // 自动保存配置
  useEffect(() => {
    if (!configLoaded) return

    const config: RoguelikeUserConfig = { taskInputs, advancedParams }
    const fingerprint = JSON.stringify(config)

    if (!skippedInitialConfigSaveRef.current) {
      skippedInitialConfigSaveRef.current = true
      lastQueuedConfigFingerprintRef.current = fingerprint
      return
    }

    if (lastQueuedConfigFingerprintRef.current === fingerprint) return

    const revision = configRevisionRef.current + 1
    configRevisionRef.current = revision
    const syncToken = createRoguelikeConfigSyncToken()

    localStorage.setItem('roguelikeTaskInputs', JSON.stringify(taskInputs))
    localStorage.setItem('roguelikeAdvancedParams', JSON.stringify(advancedParams))
    localStorage.setItem(ROGUELIKE_CONFIG_SYNC_PENDING_KEY, syncToken)
    const saveTimer = window.setTimeout(() => {
      lastQueuedConfigFingerprintRef.current = fingerprint
      void syncConfig(config, revision, syncToken)
    }, 300)

    return () => window.clearTimeout(saveTimer)
  }, [advancedParams, configLoaded, syncConfig, taskInputs])

  const handleRetryConfigSave = async () => {
    if (isRetryingConfigSave) return
    const revision = configRevisionRef.current
    const syncToken = localStorage.getItem(ROGUELIKE_CONFIG_SYNC_PENDING_KEY) ?? createRoguelikeConfigSyncToken()
    localStorage.setItem(ROGUELIKE_CONFIG_SYNC_PENDING_KEY, syncToken)
    setIsRetryingConfigSave(true)
    try {
      await syncConfig({ taskInputs, advancedParams }, revision, syncToken, true)
    } finally {
      setIsRetryingConfigSave(false)
    }
  }

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
        setIsActiveStatus(false)
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
      setIsActiveStatus(false)
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
                  id={`roguelike-${task.id}-${option.key}`}
                  name={`maa-${task.id}-${option.key}`}
                  label={option.label}
                  value={String(advanced[option.key] ?? option.options[0]?.value ?? '')}
                  onChange={(value: string) => handleAdvancedChange(task.id, option.key, value)}
                  options={option.options}
                />
              ) : (
                <Input
                  id={`roguelike-${task.id}-${option.key}`}
                  name={`maa-${task.id}-${option.key}`}
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
                <label
                  htmlFor={`roguelike-${task.id}-${option.key}`}
                  className="roguelike-toggle-label min-h-11"
                >
                  {option.label}
                </label>
                <Switch
                  id={`roguelike-${task.id}-${option.key}`}
                  name={`maa-${task.id}-${option.key}`}
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
  const activeTheme = taskInputs[activeTask.id] || ''

  return (
    <div className="app-page ios-workspace-page roguelike-page" data-workbench-tasks>
      <div className="app-stack-section">
        <PageHeader
          title="肉鸽模式"
          subtitle="集成战略与生息演算配置"
          mobileLayout="inline"
          actions={(
            <FloatingStatusIndicator
              className="w-full overflow-hidden sm:w-auto"
              textClassName="truncate whitespace-nowrap"
            />
          )}
        />

        {configSyncError && (
          <div
            role="alert"
            className="status-warning flex min-h-11 flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm leading-5"
          >
            <span className="min-w-0 flex-1">{configSyncError}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={isRetryingConfigSave}
              loadingText="同步中"
              onClick={() => void handleRetryConfigSave()}
              className="min-h-11 shrink-0"
            >
              重新同步
            </Button>
          </div>
        )}

        <div className="roguelike-workspace-grid">
          <div className="roguelike-mode-area">
            <div className="app-workspace-segments app-liquid-tab-pill roguelike-mode-shell">
              <div
                ref={modeTabsRef}
                className="app-workspace-segment-list roguelike-mode-tabs"
                role="toolbar"
                aria-label="肉鸽模式"
              >
                {activeModeRect.width > 0 && (
                  <motion.div
                    data-testid="roguelike-mode-highlight"
                    aria-hidden="true"
                    className="app-workspace-segment-indicator roguelike-mode-highlight"
                    initial={false}
                    animate={{
                      x: activeModeRect.x,
                      y: activeModeRect.y,
                      width: activeModeRect.width,
                      height: activeModeRect.height,
                    }}
                    transition={shouldReduceMotion
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 420, damping: 38, mass: 0.72 }}
                  />
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
                      onKeyDown={(event) => handleModeKeyDown(
                        event,
                        tasks.map(({ id }) => id as RoguelikeMode),
                        setActiveMode,
                      )}
                      aria-pressed={selected}
                      tabIndex={selected ? 0 : -1}
                      className={`app-workspace-segment roguelike-mode-button min-h-11 ${selected ? 'is-selected' : ''}`}
                    >
                      {IconComponent && (
                        <span className="app-workspace-segment-icon roguelike-mode-icon">
                          <IconComponent />
                        </span>
                      )}
                      <span className="app-workspace-segment-copy">
                        <span>{task.name}</span>
                        <small>{task.description}</small>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <SmoothPanel className="roguelike-panel roguelike-theme-panel">
            <div className="roguelike-panel-heading">
              <div>
                <h3>主题</h3>
                <p>选择本次运行内容</p>
              </div>
              <span>{THEME_PRESETS[activeMode].length} 个可用</span>
            </div>
            <div className="roguelike-panel-body">
              <div className="roguelike-theme-grid">
                {THEME_PRESETS[activeMode].map(theme => {
                  const selected = activeTheme === theme.value
                  return (
                    <button
                      key={theme.value}
                      type="button"
                      onClick={() => handleInputChange(activeTask.id, theme.value)}
                      aria-pressed={selected}
                      className={`roguelike-theme-option min-h-11 ${selected ? 'is-active' : ''}`}
                    >
                      <span className="roguelike-theme-copy">
                        <strong>{theme.label}</strong>
                        <small>{theme.value}</small>
                      </span>
                      {selected && <Check size={15} strokeWidth={2.4} aria-hidden="true" />}
                    </button>
                  )
                })}
              </div>
              <Input
                id={`roguelike-${activeTask.id}-theme`}
                name={`maa-${activeTask.id}-theme`}
                type="text"
                label="自定义主题代号"
                placeholder={activeTask.placeholder}
                value={activeTheme}
                onChange={(value: string) => handleInputChange(activeTask.id, value)}
                className="roguelike-custom-theme"
              />
            </div>
          </SmoothPanel>

          <SmoothPanel className="roguelike-panel roguelike-settings-panel">
            <div className="roguelike-panel-heading">
              <div>
                <h3>策略设置</h3>
                <p>{activeTask.name}</p>
              </div>
              <span>{getAdvancedOptions(activeTask.id).length} 项</span>
            </div>
            <div className="roguelike-panel-body roguelike-settings-body">
              {renderAdvancedOptions(activeTask)}
            </div>
            <div className="roguelike-panel-footer">
              {isRunning ? (
                <Button
                  onClick={handleStopTask}
                  disabled={isStopping}
                  loading={isStopping}
                  loadingText="正在终止"
                  variant="danger"
                  size="md"
                  icon={!isStopping ? <Square size={14} fill="currentColor" aria-hidden="true" /> : undefined}
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
                  icon={<Play size={15} fill="currentColor" aria-hidden="true" />}
                  className="roguelike-run-button"
                >
                  立即执行
                </Button>
              )}
            </div>
          </SmoothPanel>

          <aside className="roguelike-monitor-column" aria-label="模拟器实时预览">
            <SmoothPanel
              className="roguelike-monitor-panel"
              surfaceClassName="automation-monitor-surface roguelike-monitor-surface"
            >
              <div className="task-monitor-panel is-compact">
                <ScreenMonitor variant="compact" />
              </div>
            </SmoothPanel>
          </aside>
        </div>
      </div>
    </div>
  )
}
