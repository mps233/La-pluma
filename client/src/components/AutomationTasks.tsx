import { useState, useEffect, useRef } from 'react'
import { maaApi } from '../services/api'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { AlertTriangle, Cable, Check, CheckCircle2, ChevronDown, CircleMinus, GripVertical, ListPlus, LoaderCircle, Plus, SlidersHorizontal, Square, Trash2 } from 'lucide-react'
import Icons from './Icons'
import ScreenMonitor from './ScreenMonitor'
import NotificationSettings from './NotificationSettings'
import { EmptyState, PageHeader, Button } from './common'
import { useStatusStore } from '../store/statusStore'
import FloatingStatusIndicator from './FloatingStatusIndicator'
import type {
  AutomationTasksProps,
  AutomationAvailableTask,
  TaskFlowItem,
  ConnectionTestStatus,
  StageConfig
} from '@/types/components'
import { formatExecutionActionSummary } from '../utils/executionSummary'

const scheduleTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const RECOVERY_STATUS_POLL_MS = 1000
const RECOVERY_STATUS_TIMEOUT_MS = 30 * 60 * 1000

type RecoveryWaitResult = 'completed' | 'timeout' | 'cancelled'

const normalizeScheduleTimes = (times: string[]) =>
  [...new Set(times.filter(time => scheduleTimePattern.test(time)))]

const commaSeparatedArrayKeys = new Set(['buy_first', 'blacklist', 'first_tags', 'preserve_tags'])

const parseDropTargetEntries = (value: unknown): string[] | null => {
  if (value === undefined || value === null || value === '') return []

  const rawEntries = typeof value === 'object' && !Array.isArray(value)
    ? Object.entries(value as Record<string, unknown>).map(([itemId, count]) => `${itemId}=${count}`)
    : String(value).split(',').map(entry => entry.trim()).filter(Boolean)

  const normalizedEntries: string[] = []
  for (const entry of rawEntries) {
    const match = entry.match(/^([A-Za-z0-9_-]+)\s*=\s*(\d+)$/)
    if (!match || Number(match[2]) <= 0) return null
    normalizedEntries.push(`${match[1]}=${Number(match[2])}`)
  }
  return normalizedEntries
}

interface AutomationExecutionSummary {
  successCount: number
  failedCount: number
  skippedCount: number
  durationMs: number
  summaries: Array<{
    task: string
    stage?: string
    times?: string
    drops?: string
    duration?: string
  }>
  reports: Array<{
    provider: 'penguin' | 'yituliu'
    stage?: string
    status: 'success' | 'failed'
    message: string
  }>
  actions: Array<{
    task: string
    action: 'startup' | 'closedown' | 'depot' | 'award' | 'recruit' | 'infrast' | 'mall' | 'fight'
    status: 'success' | 'skipped' | 'failed'
    message: string
    startedCount?: number
    collectedCount?: number
    expeditedCount?: number
    refreshCount?: number
    highestLevel?: number
    detectedTags?: string[]
    finalTags?: string[]
    preservedTags?: string[]
    configuredFacilities?: string[]
    observedFacilities?: string[]
    rewardCollected?: boolean
    rotationApplied?: boolean
    droneUsed?: boolean
    cluesReceived?: number
    cluesSent?: number
    clueExchange?: boolean
    trainingContinued?: boolean
    trainingCompleted?: boolean
    trainingProcessing?: boolean
    visitedCount?: number
    creditCollected?: boolean
    purchasedCount?: number
    noMoney?: boolean
    visitLimited?: boolean
    noFriends?: boolean
    stage?: string
    times?: number
    dropCount?: number
    drops?: string
    medicine?: number
    stone?: number
    duration?: string
    sanityDepleted?: boolean
  }>
  errors: Array<string | { task: string; error: string }>
  warnings: string[]
}

const executionSummaryHasFailure = (summary: AutomationExecutionSummary) => Boolean(
  summary.failedCount > 0
  || summary.errors?.length
  || summary.actions?.some(action => action.status === 'failed')
  || summary.reports?.some(report => report.status === 'failed')
)

const migrateTaskParams = (task: any) => {
  const commandId = task.commandId || String(task.id || '').split('-')[0]
  if (!task.params) return task

  const params = { ...task.params }
  if (commandId === 'startup' || commandId === 'closedown') {
    delete params.adbPath
    delete params.address
  }
  if (commandId === 'fight') {
    params.drops ??= ''
    params.clientType ??= ''
    params.DrGrandet ??= false
    params.report_to_penguin ??= false
    params.penguin_id ??= ''
    params.report_to_yituliu ??= false
    params.yituliu_id ??= ''
  } else if (commandId === 'closedown') {
    params.recognizeDepotBeforeClose ??= true
  } else if (commandId === 'recruit') {
    if (params.preserve_tags === undefined && params.skip_robot === true) {
      params.preserve_tags = '支援机械'
    }
    params.force_refresh ??= true
    params.first_tags ??= ''
    params.extra_tags_mode ??= 0
    params.recruitment_time ??= { '3': 540, '4': 540 }
    delete params.skip_robot
  } else if (commandId === 'infrast') {
    params.filename ??= ''
    params.plan_index ??= 0
    params.continue_training ??= false
    params.dorm_notstationed_enabled ??= false
    params.dorm_trust_enabled ??= false
    params.reception_message_board ??= true
    params.reception_clue_exchange ??= true
    params.reception_send_clue ??= true
  } else if (commandId === 'mall') {
    params.visit_friends ??= true
    params.shopping ??= true
    params.buy_first ??= ''
    params.blacklist ??= ''
    params.force_shopping_if_credit_full ??= false
    params.only_buy_discount ??= false
    params.reserve_max_credit ??= false
    params.credit_fight ??= false
    params.formation_index ??= 0
  }
  return { ...task, params }
}

const synchronizeConnectionParams = (tasks: any[]) => {
  const startupTask = tasks.find(task => (task.commandId || String(task.id || '').split('-')[0]) === 'startup')
  if (!startupTask?.params) return tasks

  return tasks.map(task => {
    const commandId = task.commandId || String(task.id || '').split('-')[0]
    if (commandId !== 'closedown') return task
    return {
      ...task,
      params: {
        ...task.params,
        clientType: startupTask.params.clientType || task.params?.clientType || 'Official'
      }
    }
  })
}

export default function AutomationTasks({}: AutomationTasksProps) {
  const shouldReduceMotion = useReducedMotion()
  const { setMessage: setStatusMessage, setActive: setIsActiveStatus } = useStatusStore()

  // 辅助函数：显示消息
  const showSuccess = async (msg: string) => {
    setStatusMessage(msg, 'success')
    await new Promise(resolve => setTimeout(resolve, 1500))
    setStatusMessage('')
  }
  const showError = async (msg: string) => {
    setStatusMessage(msg, 'error')
    await new Promise(resolve => setTimeout(resolve, 2000))
    setStatusMessage('')
  }
  const showInfo = (msg: string) => {
    setStatusMessage(msg, 'info')
  }

  const [isRunning, setIsRunning] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const [taskFlow, setTaskFlow] = useState<TaskFlowItem[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [taskPickerOpen, setTaskPickerOpen] = useState(false)
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [scheduleTimes, setScheduleTimes] = useState<string[]>(['08:00', '14:00', '20:00'])
  const [currentStep, setCurrentStep] = useState(-1)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [currentActivity, setCurrentActivity] = useState<any>(null)
  const [activityName, setActivityName] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<Record<string, ConnectionTestStatus>>({})
  const [testingConnectionTaskId, setTestingConnectionTaskId] = useState<string | null>(null)
  const [lastExecutionSummary, setLastExecutionSummary] = useState<AutomationExecutionSummary | null>(null)
  const [executionDetailsOpen, setExecutionDetailsOpen] = useState(false)
  const autoSaveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const autoSaveRevisionRef = useRef(0)
  const scheduleWasRunningRef = useRef(false)
  const stopRequestInFlightRef = useRef(false)
  const connectionTestInFlightRef = useRef(false)
  const connectionTestAbortRef = useRef<AbortController | null>(null)
  const connectionTestMountedRef = useRef(true)
  const lastExecutionFingerprintRef = useRef('')
  const activeTaskId = selectedTaskId && taskFlow.some(task => task.id === selectedTaskId)
    ? selectedTaskId
    : taskFlow[0]?.id ?? null

  const applyExecutionSummary = (summary: AutomationExecutionSummary) => {
    const fingerprint = JSON.stringify(summary)
    if (lastExecutionFingerprintRef.current === fingerprint) return

    lastExecutionFingerprintRef.current = fingerprint
    setLastExecutionSummary(summary)
    setExecutionDetailsOpen(executionSummaryHasFailure(summary))
  }

  useEffect(() => {
    connectionTestMountedRef.current = true
    return () => {
      connectionTestMountedRef.current = false
      connectionTestAbortRef.current?.abort()
    }
  }, [])

  // 轮询定时任务执行状态
  useEffect(() => {
    let intervalId = null
    let isSubscribed = true // 用于防止组件卸载后的状态更新

    const checkScheduleStatus = async () => {
      if (!isSubscribed) return

      try {
        const result = await maaApi.getScheduleExecutionStatus()
        if (!isSubscribed) return // 再次检查

        if (result.success && result.data) {
          const status = result.data

          // 如果定时任务正在运行，更新 UI 状态
          if (status.isRunning) {
            scheduleWasRunningRef.current = true
            setIsRunning(true)
            if (String(status.message || '').includes('正在终止')) {
              stopRequestInFlightRef.current = true
              setIsStopping(true)
            }
            setIsActiveStatus(true)

            // 根据任务 ID 找到在 taskFlow 中的实际索引
            if (status.currentTaskId) {
              setCurrentStep(prev => {
                const actualIndex = taskFlow.findIndex(t => t.id === status.currentTaskId)
                return actualIndex !== -1 ? actualIndex : prev
              })
            } else {
              setCurrentStep(status.currentStep)
            }

            setStatusMessage(status.message || `正在执行: ${status.currentTask}`, 'info')
          } else {
            const justFinished = scheduleWasRunningRef.current
            scheduleWasRunningRef.current = false
            setIsActiveStatus(false)
            setIsRunning(false)
            if (status.lastResult) {
              applyExecutionSummary(status.lastResult as AutomationExecutionSummary)
            }

            if (justFinished) {
              setCurrentStep(-1)
              const completionMessage = status.message || '任务流程执行完成'
              const completionType = /终止|取消|失败/.test(completionMessage) ? 'warning' : 'success'
              setStatusMessage(completionMessage, completionType)
            }
          }
        }
      } catch (error) {
        // 静默失败，不影响用户体验
      }
    }

    // 每秒检查一次
    intervalId = setInterval(checkScheduleStatus, 1000)
    checkScheduleStatus() // 立即执行一次

    return () => {
      isSubscribed = false
      if (intervalId) clearInterval(intervalId)
    }
  }, [taskFlow]) // 只依赖 taskFlow

  // 可用的任务列表
  const availableTasks: AutomationAvailableTask[] = [
    {
      id: 'startup' as const,
      name: '启动游戏',
      icon: <Icons.Play />,
      description: '启动游戏并进入主界面',
      defaultParams: {
        clientType: 'Official',
        accountName: ''
      },
      paramFields: [
        { key: 'clientType', label: '客户端类型', type: 'select', options: [
          { value: 'Official', label: '官服' },
          { value: 'Bilibili', label: 'B服' },
          { value: 'YoStarEN', label: '美服' },
          { value: 'YoStarJP', label: '日服' },
          { value: 'YoStarKR', label: '韩服' },
          { value: 'Txwy', label: '繁中服' }
        ]},
        { key: 'accountName', label: '切换账号', type: 'text', placeholder: '留空则不切换', helper: '输入已登录账号的部分字符即可，如 "123****4567" 可输入 "4567"' }
      ]
    },
    {
      id: 'fight' as const,
      name: '理智作战',
      icon: <Icons.Sword />,
      description: '自动刷关卡消耗理智',
      defaultParams: {
        stage: '1-7',
        stages: [{ stage: '1-7', times: '' }],
        medicine: 0,
        expiringMedicine: 0,
        stone: 0,
        series: '1',
        drops: '',
        clientType: '',
        DrGrandet: false,
        report_to_penguin: false,
        penguin_id: '',
        report_to_yituliu: false,
        yituliu_id: ''
      },
      paramFields: [
        { key: 'stages', label: '关卡', type: 'multi-stages', placeholder: '1-7 或 HD-7', timesPlaceholder: '次数', helper: '使用 HD-数字 代表当前活动关卡，点击 + 添加更多关卡' },
        { key: 'drops', label: '掉落目标', type: 'text', placeholder: '30011=10,30062=5', helper: '任一物品达到目标数量后停止；格式为物品 ID=数量，多个目标用逗号分隔' },
        { key: 'medicine', label: '理智药', type: 'number', placeholder: '0', helper: '使用理智药数量' },
        { key: 'expiringMedicine', label: '临期药数量', type: 'number', placeholder: '0', helper: '按瓶数设置可使用的临期理智药' },
        { key: 'stone', label: '源石', type: 'number', placeholder: '0', helper: '使用源石数量' },
        { key: 'series', label: '连战', type: 'select', options: [
          { value: '-1', label: '禁用' },
          { value: '0', label: '自动' },
          { value: '1', label: '1次' },
          { value: '2', label: '2次' },
          { value: '3', label: '3次' },
          { value: '4', label: '4次' },
          { value: '5', label: '5次' },
          { value: '6', label: '6次' }
        ], helper: '单次代理作战重复次数（需要游戏支持）' },
      ]
    },
    {
      id: 'infrast' as const,
      name: '基建换班',
      icon: <Icons.Building />,
      description: '自动基建换班收菜',
      defaultParams: {
        mode: '0',
        facility: ['Mfg', 'Trade', 'Power', 'Control', 'Reception', 'Office', 'Dorm'],
        drones: 'Money',
        threshold: '0.3',
        replenish: false,
        filename: '',
        plan_index: 0,
        continue_training: false,
        dorm_notstationed_enabled: false,
        dorm_trust_enabled: false,
        reception_message_board: true,
        reception_clue_exchange: true,
        reception_send_clue: true
      },
      paramFields: [
        { key: 'mode', label: '换班模式', type: 'select', options: [
          { value: '0', label: '默认换班' },
          { value: '10000', label: '自定义换班' },
          { value: '20000', label: '一键轮换' }
        ], helper: '一键轮换使用游戏内队列，并保留无人机、会客室等基础操作' },
        { key: 'facility', label: '设施选择', type: 'facility-select', helper: '选择要换班的设施' },
        { key: 'drones', label: '无人机用途', type: 'select', options: [
          { value: '_NotUse', label: '不使用无人机' },
          { value: 'Money', label: '龙门币' },
          { value: 'SyntheticJade', label: '合成玉' },
          { value: 'CombatRecord', label: '作战记录' },
          { value: 'PureGold', label: '赤金' },
          { value: 'OriginStone', label: '源石碎片' },
          { value: 'Chip', label: '芯片' }
        ], hiddenWhen: { key: 'mode', value: '10000' } },
        { key: 'threshold', label: '心情阈值', type: 'number', placeholder: '0.3', step: '0.1', min: '0', max: '1' },
        { key: 'replenish', label: '自动补货', type: 'checkbox' },
        { key: 'filename', label: '排班文件', type: 'text', placeholder: 'schedules/base.json', helper: '自定义换班使用的排班配置文件路径', visibleWhen: { key: 'mode', value: '10000' } },
        { key: 'plan_index', label: '方案序号', type: 'number', placeholder: '0', min: '0', helper: '配置文件中的方案序号，从 0 开始', visibleWhen: { key: 'mode', value: '10000' } },
      ],
      taskType: 'Infrast'
    },
    {
      id: 'recruit' as const,
      name: '自动公招',
      icon: <Icons.Users />,
      description: '自动公开招募',
      defaultParams: {
        refresh: true,
        force_refresh: true,
        select: [4, 5, 6],
        confirm: [3, 4],
        first_tags: '',
        extra_tags_mode: 0,
        times: '4',
        set_time: true,
        expedite: false,
        expedite_times: 0,
        preserve_tags: '支援机械',
        recruitment_time: { '3': 540, '4': 540 }
      },
      paramFields: [
        { key: 'refresh', label: '刷新标签', type: 'checkbox' },
        { key: 'force_refresh', label: '无许可时仍刷新', type: 'checkbox', helper: '招聘许可耗尽后，仍会使用可用刷新次数', visibleWhen: { key: 'refresh', value: true } },
        { key: 'select', label: '招募星级', type: 'star-select', helper: '支持 6 星自动公招；勾选 6 星后会保留高价值标签并自动选择对应组合' },
        { key: 'confirm', label: '确认星级', type: 'star-select', helper: '建议至少保留 5/6 星确认，避免高价值标签被跳过' },
        { key: 'times', label: '招募次数', type: 'number', placeholder: '4' },
        { key: 'set_time', label: '设置时间', type: 'checkbox' },
        { key: 'expedite', label: '使用加急', type: 'checkbox' },
        { key: 'expedite_times', label: '加急次数', type: 'number', placeholder: '0', visibleWhen: { key: 'expedite', value: true } },
        { key: 'preserve_tags', label: '保留标签', type: 'text', placeholder: '支援机械,高级资深干员', helper: '识别到任一标签时保留该公招槽位，多个标签用逗号分隔' },
      ],
      taskType: 'Recruit'
    },
    {
      id: 'mall' as const,
      name: '信用收支',
      icon: <Icons.Cash />,
      description: '访问好友、收取信用',
      defaultParams: {
        visit_friends: true,
        shopping: true,
        buy_first: '',
        blacklist: '',
        force_shopping_if_credit_full: false,
        only_buy_discount: false,
        reserve_max_credit: false,
        credit_fight: false,
        formation_index: 0
      },
      paramFields: [
        { key: 'visit_friends', label: '访问好友', type: 'checkbox' },
        { key: 'shopping', label: '自动购物', type: 'checkbox' },
        { key: 'buy_first', label: '优先购买', type: 'text', placeholder: '招聘许可,龙门币（逗号分隔）', visibleWhen: { key: 'shopping', value: true } },
        { key: 'blacklist', label: '黑名单', type: 'text', placeholder: '家具零件,碳（逗号分隔）', visibleWhen: { key: 'shopping', value: true } },
        { key: 'only_buy_discount', label: '只买折扣商品', type: 'checkbox', helper: '仅影响优先购买之外的普通购物', visibleWhen: { key: 'shopping', value: true } },
        { key: 'reserve_max_credit', label: '保留 300 信用', type: 'checkbox', helper: '普通购物时信用低于 300 就停止购买', visibleWhen: { key: 'shopping', value: true } },
        { key: 'force_shopping_if_credit_full', label: '信用溢出时无视黑名单', type: 'checkbox', visibleWhen: { key: 'shopping', value: true } },
        { key: 'credit_fight', label: '信用助战', type: 'checkbox', helper: '借助战完成一次 OF-1，以便次日获得更多信用' },
        { key: 'formation_index', label: '助战编队', type: 'select', options: [
          { value: '0', label: '当前编队' },
          { value: '1', label: '编队 1' },
          { value: '2', label: '编队 2' },
          { value: '3', label: '编队 3' },
          { value: '4', label: '编队 4' }
        ], visibleWhen: { key: 'credit_fight', value: true } },
      ],
      taskType: 'Mall'
    },
    {
      id: 'award' as const,
      name: '领取奖励',
      icon: <Icons.Gift />,
      description: '领取每日/每周奖励',
      defaultParams: {
        award: true,
        mail: true,
        recruit: false,
        orundum: false,
        mining: false,
        specialaccess: false
      },
      paramFields: [
        { key: 'award', label: '每日奖励', type: 'checkbox' },
        { key: 'mail', label: '邮件奖励', type: 'checkbox' },
        { key: 'recruit', label: '公招奖励', type: 'checkbox' },
        { key: 'orundum', label: '合成玉奖励', type: 'checkbox' },
        { key: 'mining', label: '采矿奖励', type: 'checkbox' },
        { key: 'specialaccess', label: '特别通行证', type: 'checkbox' },
      ],
      taskType: 'Award'
    },
    {
      id: 'closedown' as const,
      name: '关闭游戏',
      icon: <Icons.Stop />,
      description: '关闭游戏客户端',
      defaultParams: {
        clientType: 'Official',
        recognizeDepotBeforeClose: false
      },
      paramFields: [
        { key: 'clientType', label: '客户端类型', type: 'select', options: [
          { value: 'Official', label: '官服' },
          { value: 'Bilibili', label: 'B服' },
          { value: 'YoStarEN', label: '美服' },
          { value: 'YoStarJP', label: '日服' },
          { value: 'YoStarKR', label: '韩服' },
          { value: 'Txwy', label: '繁中服' }
        ]},
        { key: 'recognizeDepotBeforeClose', label: '关闭前识别仓库', type: 'checkbox', helper: '启用后会先识别并保存仓库数据，再关闭游戏客户端' }
      ]
    },
  ]

  const placeClosedownLast = <T extends { id: string; commandId?: string },>(tasks: T[]) => [
    ...tasks.filter(task => task.commandId !== 'closedown' && !task.id.startsWith('closedown-')),
    ...tasks.filter(task => task.commandId === 'closedown' || task.id.startsWith('closedown-'))
  ]

  const addTaskToFlow = (task: AutomationAvailableTask) => {
    const newTask: TaskFlowItem = {
      ...task,
      params: { ...task.defaultParams },
      enabled: true,
      commandId: task.id,
      id: `${task.id}-${Date.now()}`
    }
    if (task.id === 'closedown') {
      const startupTask = taskFlow.find(flowTask => flowTask.commandId === 'startup')
      if (startupTask) {
        newTask.params.clientType = startupTask.params.clientType || 'Official'
      }
    }
    const newFlow = task.id === 'closedown'
      ? [...taskFlow, newTask]
      : placeClosedownLast([...taskFlow, newTask])

    setTaskFlow(newFlow)
    setSelectedTaskId(newTask.id)
    setTaskPickerOpen(false)
    autoSave(newFlow, scheduleEnabled, scheduleTimes)
  }

  const removeTaskFromFlow = (index: number) => {
    const newFlow = taskFlow.filter((_, i) => i !== index)
    if (taskFlow[index]?.id === activeTaskId) {
      setSelectedTaskId(newFlow[Math.min(index, newFlow.length - 1)]?.id ?? null)
    }
    setTaskFlow(newFlow)
    autoSave(newFlow, scheduleEnabled, scheduleTimes)
  }

  const toggleTaskEnabled = (index: number) => {
    const newFlow = [...taskFlow]
    const task = newFlow[index]
    if (task) {
      task.enabled = !task.enabled
      setTaskFlow(newFlow)
      autoSave(newFlow, scheduleEnabled, scheduleTimes)
    }
  }

  // moveTask 函数已被拖拽功能替代，已移除

  const handleDragStart = (index: number) => {
    setDraggedIndex(index)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (draggedIndex === null || draggedIndex === index) return

    const newFlow = [...taskFlow]
    const draggedItem = newFlow[draggedIndex]
    if (!draggedItem) return

    newFlow.splice(draggedIndex, 1)
    newFlow.splice(index, 0, draggedItem)

    setTaskFlow(newFlow)
    setDraggedIndex(index)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
    autoSave(taskFlow, scheduleEnabled, scheduleTimes)
  }

  const updateTaskParam = (index: number, key: string, value: any) => {
    const newFlow = [...taskFlow]
    const currentTask = newFlow[index]
    if (!currentTask) return

    // 如果修改的是 stages 参数，需要对关卡进行排序，但保留空白行用于继续输入。
    // 之前这里会把 { stage: '', times: '' } 过滤掉，导致“添加关卡”点击后看起来没反应。
    if (key === 'stages' && Array.isArray(value)) {
      const hasStageText = (s: string | StageConfig) =>
        typeof s === 'string' ? s.trim() !== '' : !!s.stage && s.stage.trim() !== '';

      const pinnedStages = value.filter((s): s is StageConfig =>
        typeof s === 'object' && s.pinned === true && hasStageText(s)
      );
      const smartStages = value.filter((s): s is StageConfig =>
        typeof s === 'object' && s.smart === true && hasStageText(s)
      );
      const normalStages = value.filter((s): s is string | StageConfig =>
        hasStageText(s) && (
          typeof s === 'string' ||
          (typeof s === 'object' && !s.pinned && !s.smart)
        )
      );
      const blankStages = value.filter((s): s is string | StageConfig => !hasStageText(s));

      // 重新组合：置顶 -> 智能养成 -> 普通 -> 空白输入行
      currentTask.params[key] = [...pinnedStages, ...smartStages, ...normalStages, ...blankStages];
    } else {
      currentTask.params[key] = value;
    }

    // 如果修改的是启动游戏的客户端类型，同步到关闭游戏
    const connectionKeys = new Set(['clientType'])
    if (currentTask.commandId === 'startup' && connectionKeys.has(key)) {
      newFlow.forEach((task, i) => {
        if (task.commandId === 'closedown' && newFlow[i]) {
          newFlow[i]!.params.clientType = value
        }
      })
    }
    // 如果修改的是关闭游戏的客户端类型，同步到启动游戏
    else if (currentTask.commandId === 'closedown' && connectionKeys.has(key)) {
      newFlow.forEach((task, i) => {
        if (task.commandId === 'startup' && newFlow[i]) {
          newFlow[i]!.params.clientType = value
        }
      })
    }

    setTaskFlow(newFlow)
    autoSave(newFlow, scheduleEnabled, scheduleTimes)
  }

  const testConnection = async (taskId: string) => {
    if (connectionTestInFlightRef.current) return

    const controller = new AbortController()
    const startedAt = Date.now()
    const waitForStableFeedback = async () => {
      const remaining = 450 - (Date.now() - startedAt)
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining))
    }
    connectionTestInFlightRef.current = true
    connectionTestAbortRef.current = controller
    setTestingConnectionTaskId(taskId)
    setConnectionStatus(prev => {
      const next = { ...prev }
      delete next[taskId]
      return next
    })

    try {
      const result = await maaApi.testConnection(undefined, undefined, controller.signal)
      await waitForStableFeedback()
      if (controller.signal.aborted) return
      const payload = result.data as ConnectionTestStatus | undefined
      const success = Boolean(result.success && payload?.success)
      setConnectionStatus(prev => ({
        ...prev,
        [taskId]: {
          success,
          message: payload?.message || maaApi.getErrorMessage(result),
        },
      }))
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') return
      await waitForStableFeedback()
      if (controller.signal.aborted) return
      const errorMessage = error instanceof Error ? error.message : '未知错误'
      setConnectionStatus(prev => ({
        ...prev,
        [taskId]: {
          success: false,
          message: errorMessage,
        }
      }))
    } finally {
      if (connectionTestAbortRef.current === controller) {
        connectionTestInFlightRef.current = false
        connectionTestAbortRef.current = null
        if (connectionTestMountedRef.current) setTestingConnectionTaskId(null)
      }
    }
  }

  const autoSave = (flow: TaskFlowItem[], enabled: boolean, times: string[]) => {
    const taskFlowToSave = flow.map(task => {
      const { icon, paramFields, ...rest } = task
      return rest
    })
    const normalizedTimes = normalizeScheduleTimes(times)
    const revision = ++autoSaveRevisionRef.current

    // 保存到 localStorage（快速访问）
    localStorage.setItem('maa-task-flow', JSON.stringify(taskFlowToSave))
    localStorage.setItem('maa-schedule', JSON.stringify({ enabled, times: normalizedTimes }))

    autoSaveQueueRef.current = autoSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        // 连续编辑时只提交队列中最新的一版，避免旧请求覆盖新配置。
        if (revision !== autoSaveRevisionRef.current) return

        const saveResult = await maaApi.saveUserConfig('automation-tasks', {
          taskFlow: taskFlowToSave,
          schedule: { enabled, times: normalizedTimes }
        })
        if (!saveResult.success) {
          throw new Error(maaApi.getErrorMessage(saveResult))
        }

        if (revision !== autoSaveRevisionRef.current) return

        const scheduleResult = enabled && normalizedTimes.length > 0
          ? await maaApi.setupSchedule('default', normalizedTimes, taskFlowToSave)
          : await maaApi.stopSchedule('default')

        if (!scheduleResult.success) {
          throw new Error(maaApi.getErrorMessage(scheduleResult))
        }
      })
      .catch((error: unknown) => {
        if (revision !== autoSaveRevisionRef.current) return
        const message = error instanceof Error ? error.message : '未知错误'
        void showError(`配置同步失败: ${message}`)
      })
  }

  const syncLoadedSchedule = async (times: string[], flow: any[]) => {
    const normalizedTimes = normalizeScheduleTimes(times)
    if (normalizedTimes.length === 0) return

    try {
      const result = await maaApi.setupSchedule('default', normalizedTimes, flow)
      if (!result.success) {
        throw new Error(maaApi.getErrorMessage(result))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      void showError(`定时任务恢复失败: ${message}`)
    }
  }

  const updateScheduleTime = (index: number, nextTime: string) => {
    if (scheduleTimes.some((time, itemIndex) => itemIndex !== index && time === nextTime)) {
      void showError('该执行时间已经存在')
      return
    }

    const newTimes = [...scheduleTimes]
    newTimes[index] = nextTime
    setScheduleTimes(newTimes)
    autoSave(taskFlow, scheduleEnabled, newTimes)
  }

  const restoreSchedule = async (enabled: boolean, times: string[], flow: any[]) => {
    if (enabled && times.length > 0) {
      await syncLoadedSchedule(times, flow)
    }
  }

  const buildCommand = (task: TaskFlowItem) => {
    if (task.taskType) {
      const params = task.params || {}
      const taskConfig: any = {
        name: task.name,
        type: task.taskType,
        params: {}
      }

      Object.keys(params).forEach(key => {
        const value = params[key]
        if (value === undefined || value === '' || value === null) return

        if (typeof value === 'boolean') {
          taskConfig.params[key] = value
        }
        else if (Array.isArray(value)) {
          if (value.length > 0) {
            taskConfig.params[key] = value
          }
        }
        else if (typeof value === 'string' && value.trim().startsWith('[') && value.trim().endsWith(']')) {
          taskConfig.params[key] = value.trim()
        }
        else if (typeof value === 'string' && (commaSeparatedArrayKeys.has(key) || (value.includes(',') && !value.includes('[')))) {
          taskConfig.params[key] = value.split(',').map(v => v.trim()).filter(v => v)
        }
        else if (typeof value === 'number') {
          taskConfig.params[key] = value
        }
        else if (typeof value === 'string' && !isNaN(Number(value)) && value.trim() !== '') {
          taskConfig.params[key] = Number(value)
        }
        else if (value) {
          taskConfig.params[key] = value
        }
      })

      return {
        command: 'run',
        params: task.commandId || task.id,
        taskConfig: JSON.stringify(taskConfig)
      }
    }

    const commandId = task.commandId || task.id.split('-')[0]
    let params = ''
    const extraArgs: string[] = []

    if (commandId === 'startup' || commandId === 'closedown') {
      params = task.params?.clientType || 'Official'
      if (commandId === 'startup' && task.params?.accountName?.trim()) {
        extraArgs.push(`--account-name ${task.params.accountName.trim()}`)
      }
    } else if (commandId === 'fight') {
      const stages = task.params?.stages || [{ stage: task.params?.stage || '', times: task.params?.times || '' }]
      params = stages
        .map(stageConfig => typeof stageConfig === 'string'
          ? { stage: stageConfig, times: '' }
          : stageConfig)
        .filter(stageConfig => stageConfig.stage?.trim())
        .map(stageConfig => `${stageConfig.stage.trim()}${stageConfig.times ? `:${stageConfig.times}` : ''}`)
        .join(',')
      if (task.params?.medicine !== undefined && task.params.medicine !== '' && task.params.medicine !== null) {
        params += ` -m ${task.params.medicine}`
      }
      if (task.params?.expiringMedicine !== undefined && task.params.expiringMedicine !== '' && task.params.expiringMedicine !== null) {
        params += ` --expiring-medicine ${task.params.expiringMedicine}`
      }
      if (task.params?.stone !== undefined && task.params.stone !== '' && task.params.stone !== null) {
        params += ` --stone ${task.params.stone}`
      }
      if (task.params?.series !== undefined && task.params.series !== '' && String(task.params.series) !== '1') {
        params += ` --series ${task.params.series}`
      }
      const dropTargets = parseDropTargetEntries(task.params?.drops)
      if (dropTargets === null) {
        throw new Error('掉落目标格式应为物品 ID=数量，多个目标用逗号分隔')
      }
      dropTargets.forEach(target => {
        params += ` -D${target}`
      })
      if (task.params?.clientType) params += ` --client-type ${task.params.clientType}`
      if (task.params?.DrGrandet) params += ' --dr-grandet'
      if (task.params?.report_to_penguin) {
        params += ' --report-to-penguin'
        if (task.params.penguin_id?.trim()) params += ` --penguin-id ${task.params.penguin_id.trim()}`
      }
      if (task.params?.report_to_yituliu) {
        params += ' --report-to-yituliu'
        if (task.params.yituliu_id?.trim()) params += ` --yituliu-id ${task.params.yituliu_id.trim()}`
      }
    }

    if (extraArgs.length > 0) {
      params = `${extraArgs.join(' ')} ${params}`
    }

    return { command: commandId, params }
  }

  const executeTaskFlow = async () => {
    const invalidTask = taskFlow.find(task =>
      task.enabled &&
      task.taskType === 'Infrast' &&
      Number(task.params.mode) === 10000 &&
      !String(task.params.filename || '').trim()
    )
    if (invalidTask) {
      setSelectedTaskId(invalidTask.id)
      void showError('自定义换班需要填写排班文件路径')
      return
    }

    const invalidFightDrops = taskFlow.find(task => {
      const commandId = task.commandId || task.id.split('-')[0]
      return task.enabled && commandId === 'fight' && parseDropTargetEntries(task.params.drops) === null
    })
    if (invalidFightDrops) {
      setSelectedTaskId(invalidFightDrops.id)
      void showError('掉落目标格式应为物品 ID=数量，多个目标用逗号分隔')
      return
    }

    stopRequestInFlightRef.current = false
    setIsStopping(false)
    setIsRunning(true)
    setCurrentStep(-1)
    showInfo('开始执行任务流程...')

    try {
      // 清理 taskFlow，移除不能序列化的字段（如 React 组件）
      const cleanTaskFlow = taskFlow.map(task => ({
        id: task.id,
        name: task.name,
        commandId: task.commandId,
        taskType: task.taskType,
        params: task.params,
        enabled: task.enabled
      }))

      // 直接调用后端的定时任务执行接口，复用所有逻辑
      const result = await maaApi.executeScheduleNow('manual', cleanTaskFlow)
      const executionSummary = result.data?.summary as AutomationExecutionSummary | undefined
      if (executionSummary) {
        applyExecutionSummary(executionSummary)
      }

      if (result.success && result.data?.stopped) {
        setStatusMessage(result.message || '任务流程已终止', 'warning')
      } else if (result.success) {
        const hasWarnings = Boolean(executionSummary?.warnings?.length || executionSummary?.reports?.some(report => report.status === 'failed'))
        setStatusMessage(result.message || '任务流程执行完成', hasWarnings ? 'warning' : 'success')
      } else {
        showError(`任务流程执行失败: ${result.message || '未知错误'}`)
      }
    } catch (error: any) {
      showError(`执行失败: ${error.message}`)
    } finally {
      stopRequestInFlightRef.current = false
      setIsStopping(false)
      setIsRunning(false)
      setCurrentStep(-1)
    }
  }

  const stopTaskFlow = async () => {
    if (stopRequestInFlightRef.current) return

    stopRequestInFlightRef.current = true
    setIsStopping(true)
    showInfo('正在终止任务流程...')

    // 调用后端 API 终止任务
    try {
      const result = await maaApi.stopTask()
      const taskStopped = Boolean(result.data?.task?.success)
      const scheduleStopRequested = Boolean(result.data?.scheduleStopped)

      if (!result.success || (!taskStopped && !scheduleStopRequested)) {
        const detail = result.data?.task?.message || result.message || '当前没有可终止的任务'
        stopRequestInFlightRef.current = false
        setIsStopping(false)
        void showError(`终止失败: ${detail}`)
        return
      }

      setStatusMessage('正在终止任务流程...', 'warning')
    } catch (error) {
      stopRequestInFlightRef.current = false
      setIsStopping(false)
      void showError('终止任务失败')
    }

    localStorage.removeItem('maa-task-flow-execution')
  }

  useEffect(() => {
    if (isRunning) return
    stopRequestInFlightRef.current = false
    setIsStopping(false)
  }, [isRunning])

  const loadTaskFlow = async () => {
    try {
      // 优先从服务器加载配置
      const serverConfig = await maaApi.loadUserConfig('automation-tasks')

      if (serverConfig.success && serverConfig.data) {
        // 服务器有配置，使用服务器配置
        const { taskFlow: savedTasks, schedule } = serverConfig.data
        const loadedTasks = savedTasks
          ? placeClosedownLast(synchronizeConnectionParams(savedTasks.map(migrateTaskParams)))
          : savedTasks

        if (loadedTasks) {
          const restoredTasks = loadedTasks.map((task: any) => {
            const originalTask = availableTasks.find(t => t.id === task.commandId || t.id === task.id.split('-')[0])
            return {
              ...task,
              icon: originalTask?.icon,
              paramFields: originalTask?.paramFields
            }
          })
          setTaskFlow(restoredTasks)

          // 同步到 localStorage
          localStorage.setItem('maa-task-flow', JSON.stringify(loadedTasks))
        }

        if (schedule) {
          const { enabled, times } = schedule
          const normalizedTimes = normalizeScheduleTimes(Array.isArray(times) ? times : [])
          setScheduleEnabled(enabled)
          if (normalizedTimes.length > 0) {
            setScheduleTimes(normalizedTimes)
          }

          // 同步到 localStorage
          localStorage.setItem('maa-schedule', JSON.stringify({ ...schedule, times: normalizedTimes }))

          await restoreSchedule(enabled, normalizedTimes, loadedTasks || [])
        }

        return
      }
    } catch (error) {
      // 静默失败，尝试从 localStorage 加载
    }

    // 服务器加载失败，从 localStorage 加载
    const saved = localStorage.getItem('maa-task-flow')
    const schedule = localStorage.getItem('maa-schedule')
    if (saved) {
      const loadedTasks = placeClosedownLast(synchronizeConnectionParams(JSON.parse(saved).map(migrateTaskParams)))
      const restoredTasks = loadedTasks.map((task: any) => {
        const originalTask = availableTasks.find(t => t.id === task.commandId || t.id === task.id.split('-')[0])
        return {
          ...task,
          icon: originalTask?.icon,
          paramFields: originalTask?.paramFields
        }
      })
      setTaskFlow(restoredTasks)

      if (schedule) {
        const { enabled, times } = JSON.parse(schedule)
        const normalizedTimes = normalizeScheduleTimes(Array.isArray(times) ? times : [])
        setScheduleEnabled(enabled)
        if (normalizedTimes.length > 0) {
          setScheduleTimes(normalizedTimes)
        }

        await restoreSchedule(enabled, normalizedTimes, loadedTasks)
      }
    }
  }

  // updateScheduleTime 函数已被内联处理替代，已移除

  const handleScheduleEnabledChange = (enabled: boolean) => {
    setScheduleEnabled(enabled)
    autoSave(taskFlow, enabled, scheduleTimes)
  }

  const addScheduleTime = () => {
    const candidates = Array.from({ length: 24 }, (_, offset) =>
      `${String((12 + offset) % 24).padStart(2, '0')}:00`
    )
    const nextTime = candidates.find(time => !scheduleTimes.includes(time))
    if (!nextTime) {
      void showError('没有可添加的执行时间')
      return
    }

    const newTimes = [...scheduleTimes, nextTime]
    setScheduleTimes(newTimes)
    autoSave(taskFlow, scheduleEnabled, newTimes)
  }

  const removeScheduleTime = (index: number) => {
    const newTimes = scheduleTimes.filter((_, i) => i !== index)
    setScheduleTimes(newTimes)
    autoSave(taskFlow, scheduleEnabled, newTimes)
  }

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const cancellationHandlers = new Set<() => void>()

    const cancelRecoveryWork = () => {
      cancelled = true
      controller.abort()
      Array.from(cancellationHandlers).forEach(cancel => cancel())
      cancellationHandlers.clear()
    }

    const waitForDelay = (durationMs: number) => new Promise<boolean>((resolve) => {
      if (cancelled) {
        resolve(false)
        return
      }

      let settled = false
      const timer = window.setTimeout(() => finish(true), durationMs)
      const finish = (completed: boolean) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        cancellationHandlers.delete(cancel)
        resolve(completed)
      }
      const cancel = () => finish(false)
      cancellationHandlers.add(cancel)
    })

    const waitForTaskCompletion = () => new Promise<RecoveryWaitResult>((resolve) => {
      if (cancelled) {
        resolve('cancelled')
        return
      }

      let settled = false
      let requestInFlight = false
      let intervalId: number | null = null
      let timeoutId: number | null = null

      const finish = (result: RecoveryWaitResult) => {
        if (settled) return
        settled = true
        if (intervalId !== null) window.clearInterval(intervalId)
        if (timeoutId !== null) window.clearTimeout(timeoutId)
        cancellationHandlers.delete(cancel)
        resolve(result)
      }
      const cancel = () => finish('cancelled')
      const checkStatus = async () => {
        if (cancelled || requestInFlight || settled) return
        requestInFlight = true
        try {
          const statusResult = await maaApi.getTaskStatus(controller.signal)
          if (cancelled) {
            finish('cancelled')
          } else if (statusResult.success && statusResult.data?.isRunning === false) {
            finish('completed')
          }
        } catch (error) {
          if (cancelled || (error instanceof Error && error.name === 'AbortError')) {
            finish('cancelled')
          }
        } finally {
          requestInFlight = false
        }
      }

      cancellationHandlers.add(cancel)
      intervalId = window.setInterval(() => void checkStatus(), RECOVERY_STATUS_POLL_MS)
      timeoutId = window.setTimeout(() => finish('timeout'), RECOVERY_STATUS_TIMEOUT_MS)
      void checkStatus()
    })

    const reportWaitTimeout = (taskName: string) => {
      setStatusMessage(`${taskName} 状态等待超时，已停止前端续跑，请检查后端任务状态`, 'warning')
    }

    // 先加载任务流程
    const initializeAndRestore = async () => {
      // 1. 先加载任务流程
      await loadTaskFlow()
      if (cancelled) return

      // 2. 获取当前活动信息
      try {
        const activityResult = await maaApi.getActivity('Official')
        if (cancelled) return
        if (activityResult.success && activityResult.data?.code) {
          setCurrentActivity(activityResult.data.code)
          setActivityName(activityResult.data.name)
        }
      } catch (error) {
        // 静默失败，不影响用户体验
      }

      // 3. 然后检查是否需要恢复执行
      try {
        const result = await maaApi.getTaskStatus(controller.signal)
        if (cancelled) return

        // 检查是否有任务流程正在执行
        const flowExecution = localStorage.getItem('maa-task-flow-execution')

        if (flowExecution) {
          const { isExecuting, tasks, currentIndex } = JSON.parse(flowExecution)
          const restoredTasks = Array.isArray(tasks) ? tasks : []
          const restoredCurrentIndex = Number.isInteger(currentIndex) ? currentIndex : -1

          if (isExecuting && restoredTasks.length > 0) {
            setIsRunning(true)
            showInfo(`恢复任务流程执行...`)

            const continueTaskFlow = async () => {
              // 从 localStorage 加载任务流程，找到当前执行的任务
              const savedTaskFlow = localStorage.getItem('maa-task-flow')
              if (!savedTaskFlow) {
                setStatusMessage('无法恢复任务流程', 'error')
                setIsRunning(false)
                setCurrentStep(-1)
                localStorage.removeItem('maa-task-flow-execution')
                return
              }

              const parsedTasks = JSON.parse(savedTaskFlow)
              const loadedTasks = Array.isArray(parsedTasks) ? parsedTasks : []
              if (cancelled) return

              const currentRun = result.data
              if (result.success && currentRun?.isRunning) {
                const currentTaskInfo = restoredTasks[restoredCurrentIndex]
                if (currentTaskInfo) {
                  // 找到当前任务在 taskFlow 中的索引
                  const currentTask = loadedTasks.find((t: any) => {
                    const tCommandId = t.commandId || t.id.split('-')[0]
                    return tCommandId === currentTaskInfo.commandId
                  })

                  if (currentTask) {
                    const actualIndex = loadedTasks.findIndex((t: any) => t.id === currentTask.id)
                    setCurrentStep(actualIndex)
                  }
                }

                showInfo(`正在执行: ${currentRun.taskName}`)

                // 等待当前任务完成
                const waitResult = await waitForTaskCompletion()
                if (waitResult === 'cancelled') return
                if (waitResult === 'timeout') {
                  reportWaitTimeout(currentRun.taskName || '当前任务')
                  return
                }
              }

              // 继续执行剩余任务
              const remainingTasks = restoredTasks.slice(restoredCurrentIndex + 1)

              if (remainingTasks.length > 0) {
                for (let i = 0; i < remainingTasks.length; i++) {
                  const taskInfo = remainingTasks[i]
                  if (cancelled || !taskInfo) return

                  // 使用 commandId 匹配任务
                  const task = loadedTasks.find((t: any) => {
                    const tCommandId = t.commandId || t.id.split('-')[0]
                    return tCommandId === taskInfo.commandId && t.enabled
                  })

                  if (!task) {
                    continue
                  }

                  const actualIndex = loadedTasks.findIndex((t: any) => t.id === task.id)
                  setCurrentStep(actualIndex)
                  showInfo(`正在执行: ${task.name}`)

                  localStorage.setItem('maa-task-flow-execution', JSON.stringify({
                    isExecuting: true,
                    tasks: restoredTasks,
                    currentIndex: restoredCurrentIndex + i + 1,
                    startTime: Date.now()
                  }))

                  try {
                    const { command, params, taskConfig } = buildCommand(task)
                    const result = await maaApi.executePredefinedTask(
                      command,
                      params,
                      taskConfig as any,
                      controller.signal,
                      task.name,
                      'automation',
                      false
                    )
                    if (cancelled) return

                    if (!result.success) {
                      setStatusMessage(`${task.name} 提交失败: ${maaApi.getErrorMessage(result)}`, 'error')
                      setIsRunning(false)
                      setCurrentStep(-1)
                      localStorage.removeItem('maa-task-flow-execution')
                      return
                    }

                    const waitResult = await waitForTaskCompletion()
                    if (waitResult === 'cancelled') return
                    if (waitResult === 'timeout') {
                      reportWaitTimeout(task.name)
                      return
                    }

                    // 任务完成后的延迟时间
                    // 启动游戏需要更长的等待时间，确保游戏完全启动
                    const commandId = task.commandId || task.id.split('-')[0]
                    const delayTime = commandId === 'startup' ? 15000 : commandId === 'closedown' ? 3000 : 2000

                    showInfo(`${task.name} 完成，等待 ${delayTime / 1000} 秒后继续...`)
                    if (!await waitForDelay(delayTime)) return
                  } catch (error) {
                    if (cancelled || (error instanceof Error && error.name === 'AbortError')) return
                    setStatusMessage(`${task.name} 恢复执行失败`, 'error')
                    setIsRunning(false)
                    setCurrentStep(-1)
                    localStorage.removeItem('maa-task-flow-execution')
                    return
                  }
                }
              }

              if (cancelled) return
              setStatusMessage('所有任务执行完成！', 'success')
              setIsRunning(false)
              setCurrentStep(-1)
              localStorage.removeItem('maa-task-flow-execution')
            }

            await continueTaskFlow()
            return
          }
        }

        const currentRun = result.data
        if (result.success && currentRun?.isRunning) {
          const { taskName, startTime, taskType } = currentRun

          if (taskType === 'automation') {
            const elapsedMinutes = (Date.now() - startTime) / 1000 / 60
            setIsRunning(true)
            setCurrentStep(0)
            if (elapsedMinutes > 5) {
              showInfo(`${taskName} 可能已完成（已运行 ${Math.floor(elapsedMinutes)} 分钟）`)
            } else {
              showInfo(`正在执行: ${taskName}`)
            }

            const waitResult = await waitForTaskCompletion()
            if (waitResult === 'completed' && !cancelled) {
              setIsRunning(false)
              setCurrentStep(-1)
              setStatusMessage('任务已完成', 'success')
            } else if (waitResult === 'timeout' && !cancelled) {
              reportWaitTimeout(taskName || '当前任务')
            }
          }
        }
      } catch (error) {
        // 静默失败，不影响用户体验
      }
    }

    void initializeAndRestore()

    return cancelRecoveryWork
    // Recovery is mount-scoped; rerunning it would create a second task runner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 监听养成计划应用事件，自动刷新任务流程
  useEffect(() => {
    const handleTrainingPlanApplied = async (event: any) => {
      await loadTaskFlow()
      showSuccess(`智能养成计划已更新：${event.detail?.stageCount || 0} 个关卡`)
    }

    window.addEventListener('training-plan-applied', handleTrainingPlanApplied)

    return () => {
      window.removeEventListener('training-plan-applied', handleTrainingPlanApplied)
    }
  }, [])

  // 监听页面可见性变化，切换回来时自动刷新
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (!document.hidden) {
        // 页面重新可见时，重新加载任务流程
        await loadTaskFlow()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  // 使用 IntersectionObserver 监听组件可见性
  useEffect(() => {
    const containerRef = document.querySelector('[data-automation-tasks]')
    if (!containerRef) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // 组件变为可见时，重新加载任务流程
            loadTaskFlow()
          }
        })
      },
      { threshold: 0.1 } // 当至少 10% 可见时触发
    )

    observer.observe(containerRef)

    return () => {
      observer.disconnect()
    }
  }, [])

  const schedulePanel = (
    <div className="automation-schedule-column">
      <div className="automation-schedule-panel surface-panel">
        <div className="automation-schedule-heading">
          <div>
            <h3><Icons.Clock /><span>定时与通知</span></h3>
            <p>自动运行与结果推送</p>
          </div>
          <div className="automation-schedule-actions">
            <label className="automation-schedule-enabled">
              <input
                type="checkbox"
                checked={scheduleEnabled}
                onChange={(e) => handleScheduleEnabledChange(e.target.checked)}
                disabled={isRunning}
                className="custom-checkbox cursor-pointer"
              />
              <span>{scheduleEnabled ? '已启用' : '未启用'}</span>
            </label>
          </div>
        </div>

        {scheduleEnabled ? (
          <motion.div
            className="automation-schedule-body"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            <div className="automation-schedule-list-heading">
              <span>执行时间</span>
              <small>{scheduleTimes.length}/6</small>
            </div>
            <div className="automation-schedule-times">
              {scheduleTimes.map((time, index) => {
                const [hour, minute] = time.split(':')

                return (
                  <div key={`${time}-${index}`} className="automation-schedule-time-row">
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <div className="automation-schedule-time-control">
                      <select
                        value={hour}
                        onChange={(e) => {
                          updateScheduleTime(index, `${e.target.value.padStart(2, '0')}:${minute}`)
                        }}
                        disabled={isRunning}
                        aria-label={`第 ${index + 1} 个执行时间的小时`}
                      >
                        {Array.from({ length: 24 }, (_, i) => {
                          const value = i.toString().padStart(2, '0')
                          return <option key={value} value={value}>{value}</option>
                        })}
                      </select>
                      <strong>:</strong>
                      <select
                        value={minute}
                        onChange={(e) => {
                          updateScheduleTime(index, `${hour}:${e.target.value.padStart(2, '0')}`)
                        }}
                        disabled={isRunning}
                        aria-label={`第 ${index + 1} 个执行时间的分钟`}
                      >
                        {Array.from({ length: 60 }, (_, i) => {
                          const value = i.toString().padStart(2, '0')
                          return <option key={value} value={value}>{value}</option>
                        })}
                      </select>
                    </div>
                    {scheduleTimes.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => removeScheduleTime(index)}
                        disabled={isRunning}
                        className="automation-schedule-remove"
                        title="删除时间点"
                      >
                        <Trash2 size={14} strokeWidth={1.9} />
                      </button>
                    ) : <span className="automation-schedule-remove-placeholder" />}
                  </div>
                )
              })}
            </div>
            {scheduleTimes.length < 6 && (
              <button
                type="button"
                onClick={addScheduleTime}
                disabled={isRunning}
                className="automation-schedule-add"
              >
                <Plus size={15} strokeWidth={2} />
                <span>添加时间点</span>
              </button>
            )}
          </motion.div>
        ) : (
          <div className="automation-schedule-empty">
            <span><Icons.Clock /></span>
            <strong>尚未启用</strong>
            <p>启用后设置自动执行时间</p>
          </div>
        )}

        <NotificationSettings />
      </div>
    </div>
  )

  return (
    <>
      <div className="app-page" data-automation-tasks>
        <div className="app-stack-section">
        {/* 页面标题 */}
        <PageHeader
          icon={<Icons.Robot />}
          title="自动化任务"
          subtitle="编排日常任务流程，一键执行或定时运行"
          actions={
            <div className="flex items-center space-x-4">
              <FloatingStatusIndicator />
              {/* 活动状态 */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className={`hidden sm:flex px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-medium border items-center space-x-1.5 sm:space-x-2 ${
                  currentActivity
                    ? 'brand-action-subtle border-transparent'
                    : 'bg-gray-50 dark:bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-500/30'
                }`}
              >
                {currentActivity ? (
                  <>
                    <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span className="hidden sm:inline">当前活动: {activityName || currentActivity}</span>
                    <span className="sm:hidden">{currentActivity}</span>
                    {activityName && (
                      <span className="text-xs opacity-75 hidden sm:inline">({currentActivity})</span>
                    )}
                  </>
                ) : (
                  <>
                    <svg className="hidden sm:block w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                    <span className="hidden sm:inline">长草中～</span>
                  </>
                )}
              </motion.div>
            </div>
          }
        />

        {/* 实时预览 + 定时与通知 */}
        <div className="automation-overview-grid">
          <div className="automation-monitor-column">
            <div className="automation-monitor-panel p-[var(--app-space-panel)] surface-panel transition-colors">
              <ScreenMonitor />
            </div>
          </div>

          {schedulePanel}
        </div>

        {/* 下半部分：任务流程 + 当前配置 */}
        <div className="automation-builder-grid">
          {/* 紧凑流程顺序 */}
          <div className="automation-sequence-column">
            <div className="automation-sequence-panel surface-panel">
              <div className="automation-flow-header">
                <div className="min-w-0">
                  <h3>
                    <Icons.Clipboard />
                    <span>任务流程</span>
                  </h3>
                  <p>按顺序执行，可拖拽调整</p>
                </div>
                <span className="automation-flow-summary">
                  {taskFlow.filter(t => t.enabled).length}/{taskFlow.length}
                </span>
              </div>

              {taskFlow.length === 0 ? (
                <EmptyState
                  className="automation-sequence-empty"
                  compact
                  icon={<ListPlus size={20} strokeWidth={1.8} />}
                  title="流程为空"
                  description="使用下方入口添加任务"
                />
              ) : (
                <div className="automation-sequence-list">
                  {taskFlow.map((task, index) => {
                    const isCurrentStep = currentStep === index
                    const isCompletedStep = isRunning && task.enabled && currentStep > index

                    return (
                      <motion.div
                        key={task.id}
                        layout={!shouldReduceMotion}
                        onDragOver={(e) => handleDragOver(e, index)}
                        className={`automation-sequence-item${activeTaskId === task.id ? ' is-selected' : ''}${isCurrentStep ? ' is-current' : ''}${isCompletedStep ? ' is-completed' : ''}${!task.enabled ? ' is-disabled' : ''}${draggedIndex === index ? ' is-dragging' : ''}`}
                      >
                      <span
                        draggable={!isRunning}
                        onDragStart={isRunning ? undefined : () => handleDragStart(index)}
                        onDragEnd={isRunning ? undefined : handleDragEnd}
                        className={`automation-sequence-drag${isRunning ? ' is-placeholder' : ''}`}
                        title={isRunning ? undefined : '拖拽排序'}
                        aria-hidden={isRunning}
                      >
                        {!isRunning && <GripVertical size={16} strokeWidth={1.8} />}
                      </span>
                      <button
                        type="button"
                        className="automation-sequence-select"
                        onClick={() => setSelectedTaskId(task.id)}
                      >
                        <span className="automation-sequence-node" aria-hidden="true">
                          <AnimatePresence initial={false} mode="wait">
                            <motion.span
                              key={isCompletedStep ? 'completed' : isCurrentStep ? 'current' : 'pending'}
                              initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.7 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.7 }}
                              transition={{ duration: 0.16 }}
                            >
                              {isCompletedStep
                                ? <Check size={11} strokeWidth={2.8} />
                                : String(index + 1).padStart(2, '0')}
                            </motion.span>
                          </AnimatePresence>
                        </span>
                        <span className="automation-sequence-icon">{task.icon}</span>
                        <span className="automation-sequence-copy">
                          <strong>{task.name}</strong>
                          <small>{isCurrentStep ? '正在执行' : isCompletedStep ? '已完成' : task.description}</small>
                        </span>
                      </button>
                      <label className="automation-sequence-enabled" title={task.enabled ? '停用任务' : '启用任务'}>
                        <input
                          type="checkbox"
                          checked={task.enabled}
                          onChange={() => toggleTaskEnabled(index)}
                          disabled={isRunning}
                          className="custom-checkbox cursor-pointer"
                        />
                        <span className="sr-only">{task.enabled ? '已启用' : '已停用'}</span>
                      </label>
                      {isCurrentStep ? (
                        <span className="automation-current-spinner">
                          <LoaderCircle className="animate-spin" strokeWidth={2.2} />
                        </span>
                      ) : isCompletedStep ? (
                        <span className="automation-completed-mark" title="已完成">
                          <Check size={14} strokeWidth={2.4} />
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => removeTaskFromFlow(index)}
                          disabled={isRunning}
                          className="automation-sequence-delete"
                          title="删除任务"
                        >
                          <Trash2 size={14} strokeWidth={1.9} />
                        </button>
                      )}
                      </motion.div>
                    )
                  })}
                </div>
              )}

              <div className="automation-sequence-footer">
                  <button
                    type="button"
                    className={`automation-task-picker-toggle${taskPickerOpen ? ' is-open' : ''}`}
                    onClick={() => setTaskPickerOpen(open => !open)}
                    disabled={isRunning}
                    aria-expanded={taskPickerOpen}
                  >
                    <Plus size={16} strokeWidth={2.1} />
                    <span>添加任务</span>
                    <small>{availableTasks.length}</small>
                  </button>
                  {taskPickerOpen && (
                    <div className="automation-task-picker">
                      {availableTasks.map(task => {
                        const addedCount = taskFlow.filter(flowTask => flowTask.commandId === task.id).length

                        return (
                          <button
                            key={task.id}
                            type="button"
                            onClick={() => addTaskToFlow(task)}
                            className="automation-task-picker-option"
                          >
                            <span>{task.icon}</span>
                            <strong>{task.name}</strong>
                            {addedCount > 0 && <small>{addedCount}</small>}
                            <Plus size={14} strokeWidth={2} />
                          </button>
                        )
                      })}
                    </div>
                  )}
                  <Button
                    onClick={executeTaskFlow}
                    disabled={isRunning || taskFlow.filter(t => t.enabled).length === 0}
                    loading={isRunning}
                    loadingText="执行中"
                    statusKey={isRunning ? 'running' : 'ready'}
                    variant="gradient"
                    className={`automation-run-button w-full justify-center whitespace-nowrap${isRunning ? ' is-running' : ''}`}
                    icon={
                      <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                        <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                      </svg>
                    }
                  >
                    立即执行
                  </Button>
                  {isRunning && (
                    <Button
                      onClick={stopTaskFlow}
                      disabled={isStopping}
                      loading={isStopping}
                      loadingText="正在终止"
                      statusKey={isStopping ? 'stopping' : 'stop-ready'}
                      variant={isStopping ? 'secondary' : 'danger'}
                      className={`automation-stop-button w-full justify-center${isStopping ? ' is-stopping' : ''}`}
                      icon={<Square size={14} fill="currentColor" />}
                    >
                      终止执行
                    </Button>
                  )}
              </div>

              {lastExecutionSummary && (
                <section className="border-t border-[var(--app-border)] px-3.5 py-3 sm:px-4" aria-label="最近执行结果">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-200">最近执行</h4>
                    <span className="text-[11px] text-gray-400 dark:text-gray-500">
                      成功 {lastExecutionSummary.successCount}
                      {lastExecutionSummary.failedCount > 0 && ` · 失败 ${lastExecutionSummary.failedCount}`}
                      {lastExecutionSummary.skippedCount > 0 && ` · 跳过 ${lastExecutionSummary.skippedCount}`}
                      {` · ${Math.max(1, Math.round(lastExecutionSummary.durationMs / 1000))} 秒`}
                    </span>
                  </div>

                  <div className="mt-2 flex min-w-0 items-center gap-2">
                    {executionSummaryHasFailure(lastExecutionSummary)
                      ? <AlertTriangle size={14} className="shrink-0 text-red-500" strokeWidth={2} />
                      : lastExecutionSummary.skippedCount > 0 && lastExecutionSummary.successCount === 0
                        ? <CircleMinus size={14} className="shrink-0 text-gray-400" strokeWidth={2} />
                        : <CheckCircle2 size={14} className="shrink-0 text-emerald-500" strokeWidth={2} />}
                    <span className="min-w-0 flex-1 text-xs leading-5 text-gray-600 dark:text-gray-300">
                      {formatExecutionActionSummary(lastExecutionSummary.actions)
                        || (lastExecutionSummary.failedCount > 0
                          ? `${lastExecutionSummary.failedCount} 项任务执行失败`
                          : lastExecutionSummary.skippedCount > 0
                            ? `${lastExecutionSummary.skippedCount} 项任务已跳过`
                            : '任务流程执行完成')}
                    </span>
                    <button
                      type="button"
                      onClick={() => setExecutionDetailsOpen(open => !open)}
                      aria-expanded={executionDetailsOpen}
                      aria-label={executionDetailsOpen ? '收起执行详情' : '展开执行详情'}
                      title={executionDetailsOpen ? '收起详情' : '展开详情'}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-black/5 hover:text-gray-600 dark:hover:bg-white/5 dark:hover:text-gray-200"
                    >
                      <ChevronDown
                        size={15}
                        strokeWidth={2}
                        className={`transition-transform duration-200 ${executionDetailsOpen ? 'rotate-180' : ''}`}
                      />
                    </button>
                  </div>

                  {executionDetailsOpen && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="overflow-hidden"
                    >
                      {lastExecutionSummary.summaries.some(summary => summary.stage || summary.drops) && (
                        <div className="mt-2 space-y-2 border-t border-[var(--app-border)] pt-2">
                          {lastExecutionSummary.summaries
                            .filter(summary => summary.stage || summary.drops)
                            .map((summary, summaryIndex) => (
                              <div key={`${summary.task}-${summary.stage || summaryIndex}`} className="min-w-0 text-xs">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-gray-700 dark:text-gray-200">
                                  <span className="font-semibold">{summary.stage || summary.task}</span>
                                  {summary.times && <span className="text-gray-400">{summary.times} 次</span>}
                                  {summary.duration && <span className="text-gray-400">{summary.duration}</span>}
                                </div>
                                {summary.drops && (
                                  <p className="mt-1 break-words leading-5 text-gray-500 dark:text-gray-400">{summary.drops}</p>
                                )}
                              </div>
                            ))}
                        </div>
                      )}

                      {lastExecutionSummary.reports.length > 0 && (
                        <div className="mt-2 space-y-1.5 border-t border-[var(--app-border)] pt-2">
                          {lastExecutionSummary.reports.map((report, reportIndex) => (
                            <div
                              key={`${report.provider}-${report.stage || reportIndex}-${reportIndex}`}
                              className={`flex min-w-0 items-start gap-2 text-xs ${report.status === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}
                            >
                              {report.status === 'success'
                                ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" strokeWidth={2} />
                                : <AlertTriangle size={14} className="mt-0.5 shrink-0" strokeWidth={2} />}
                              <span className="min-w-0 break-words">
                                {report.message}{report.stage ? ` · ${report.stage}` : ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {lastExecutionSummary.actions?.length > 0 && (
                        <div className="mt-2 space-y-1.5 border-t border-[var(--app-border)] pt-2">
                          {lastExecutionSummary.actions.map((action, actionIndex) => (
                            <div
                              key={`${action.action}-${action.task}-${actionIndex}`}
                              className={`flex min-w-0 items-start gap-2 text-xs ${action.status === 'success' ? 'text-emerald-600 dark:text-emerald-400' : action.status === 'skipped' ? 'text-gray-500 dark:text-gray-400' : 'text-red-600 dark:text-red-400'}`}
                            >
                              {action.status === 'success'
                                ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" strokeWidth={2} />
                                : action.status === 'skipped'
                                  ? <CircleMinus size={14} className="mt-0.5 shrink-0" strokeWidth={2} />
                                  : <AlertTriangle size={14} className="mt-0.5 shrink-0" strokeWidth={2} />}
                              <span className="min-w-0 break-words">{action.message}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {lastExecutionSummary.errors
                        ?.filter(error => {
                          const taskName = typeof error === 'string' ? error : error.task
                          return !lastExecutionSummary.actions?.some(action => action.status === 'failed' && action.task === taskName)
                        })
                        .map((error, errorIndex) => (
                          <p key={`${typeof error === 'string' ? error : error.task}-${errorIndex}`} className="mt-2 flex items-start gap-2 text-xs leading-5 text-red-600 dark:text-red-400">
                            <AlertTriangle size={14} className="mt-0.5 shrink-0" strokeWidth={2} />
                            <span>{typeof error === 'string' ? error : `${error.task}：${error.error}`}</span>
                          </p>
                        ))}

                      {lastExecutionSummary.warnings.map((warning, warningIndex) => (
                        <p key={`${warning}-${warningIndex}`} className="mt-2 flex items-start gap-2 text-xs leading-5 text-amber-600 dark:text-amber-400">
                          <AlertTriangle size={14} className="mt-0.5 shrink-0" strokeWidth={2} />
                          <span>{warning}</span>
                        </p>
                      ))}
                    </motion.div>
                  )}
                </section>
              )}
            </div>
          </div>

          {/* 当前任务配置 */}
          <div className="automation-editor-column">
            <div className="automation-editor-panel surface-panel">
              <div className="automation-editor-heading">
                <div>
                  <h3><Icons.Settings /><span>任务配置</span></h3>
                  <p>选择流程步骤后调整参数</p>
                </div>
                {activeTaskId && (
                  <span>{String(taskFlow.findIndex(task => task.id === activeTaskId) + 1).padStart(2, '0')}</span>
                )}
              </div>
              {!activeTaskId ? (
                <div className="automation-editor-empty">
                  <SlidersHorizontal size={22} strokeWidth={1.7} />
                  <strong>暂无可配置任务</strong>
                  <span>先从左侧任务库添加任务</span>
                </div>
              ) : (
                <div className="automation-editor-content">
                  {taskFlow.filter(task => task.id === activeTaskId).map((task) => {
                    const index = taskFlow.findIndex(item => item.id === task.id)
                    const connectionFeedback = connectionStatus[task.id]
                    const isTestingConnection = testingConnectionTaskId === task.id

                    return (
                    <div
                      key={task.id}
                      className={`automation-task-editor${currentStep === index ? ' is-current' : ''}${!task.enabled ? ' is-disabled' : ''}`}
                    >
                      <div className="automation-flow-card-header">
                        <div className="automation-flow-card-identity">
                          <span className="automation-flow-sequence">{String(index + 1).padStart(2, '0')}</span>
                          {!isRunning && (
                            <span
                              draggable={true}
                              onDragStart={() => handleDragStart(index)}
                              onDragEnd={handleDragEnd}
                              className="automation-drag-handle"
                              title="拖拽排序"
                              aria-label="拖拽排序"
                            >
                              <GripVertical size={18} strokeWidth={1.8} />
                            </span>
                          )}
                          <span className="automation-flow-task-icon">{task.icon}</span>
                          <span className="automation-flow-task-name">
                            <strong>{task.name}</strong>
                            <small>{currentStep === index ? '正在执行' : task.taskType || task.commandId}</small>
                          </span>
                        </div>
                        <div className="automation-flow-card-controls">
                          <label className="automation-enabled-control">
                            <input
                              type="checkbox"
                              checked={task.enabled}
                              onChange={() => toggleTaskEnabled(index)}
                              disabled={isRunning}
                              className="custom-checkbox cursor-pointer"
                            />
                            <span>{task.enabled ? '已启用' : '已停用'}</span>
                          </label>
                          {currentStep === index ? (
                            <span className="automation-current-spinner">
                              <LoaderCircle className="animate-spin" strokeWidth={2.2} />
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => removeTaskFromFlow(index)}
                              disabled={isRunning}
                              className="automation-delete-task"
                              title="删除任务"
                            >
                              <Trash2 size={16} strokeWidth={1.9} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* 参数配置区域 */}
                      {task.paramFields && task.paramFields.length > 0 && (
                        <div className="space-y-3">
                          {task.paramFields.map((field) => {
                            if (field.visibleWhen && String(task.params[field.visibleWhen.key] ?? '') !== String(field.visibleWhen.value)) {
                              return null
                            }
                            if (field.hiddenWhen && String(task.params[field.hiddenWhen.key] ?? '') === String(field.hiddenWhen.value)) {
                              return null
                            }
                            return (
                            <div key={field.key}>
                              {field.type === 'checkbox' ? (
                                <label className="flex items-center space-x-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer group">
                                  <input
                                    type="checkbox"
                                    checked={task.params[field.key] || false}
                                    onChange={(e) => updateTaskParam(index, field.key, e.target.checked)}
                                    disabled={isRunning || !task.enabled}
                                    className="custom-checkbox cursor-pointer"
                                  />
                                  <span className="group-hover:text-[var(--app-accent)] transition-colors">{field.label}</span>
                                </label>
                              ) : field.type === 'multi-stages' ? (
                                <div className="space-y-2">
                                  {(task.params.stages || [{ stage: '', times: '' }]).map((stageItem, stageIndex) => (
                                    <div key={stageIndex}>
                                      <div className="flex items-center space-x-2">
                                        {stageIndex === 0 && (
                                          <label className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap" style={{ width: '80px', flexShrink: 0 }}>{field.label}:</label>
                                        )}
                                        {stageIndex > 0 && (
                                          <div style={{ width: '80px', flexShrink: 0 }}></div>
                                        )}
                                        <div className="flex items-center space-x-2 flex-1">
                                        <div className={`automation-composite-control automation-stage-control relative inline-flex items-center overflow-hidden ${
                                          typeof stageItem === 'object' && stageItem.pinned
                                            ? 'is-accented'
                                            : typeof stageItem === 'object' && stageItem.smart
                                              ? 'is-accented'
                                              : ''
                                        }`}>
                                        {/* 置顶/智能标识按钮 - 绝对定位在输入框内部左侧 */}
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const newStages = [...(task.params.stages || [{ stage: '', times: '' }])];
                                            const currentItem = newStages[stageIndex];
                                            // 切换置顶状态
                                            if (typeof currentItem === 'string') {
                                              newStages[stageIndex] = { stage: currentItem, times: '', pinned: true };
                                            } else if (currentItem) {
                                              newStages[stageIndex] = { ...currentItem, pinned: !currentItem.pinned };
                                            }
                                            updateTaskParam(index, 'stages', newStages);
                                          }}
                                          disabled={isRunning || !task.enabled || (typeof stageItem === 'object' && stageItem.smart)}
                                          className={`absolute left-1 top-1/2 -translate-y-1/2 p-1 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed z-10 ${
                                            (typeof stageItem === 'object' && stageItem.smart)
                                              ? 'brand-text'
                                              : (typeof stageItem === 'object' && stageItem.pinned)
                                                ? 'brand-text hover:bg-[var(--app-accent-soft)]'
                                                : 'text-gray-300/50 dark:text-gray-600/50 hover:bg-gray-500/10'
                                          }`}
                                          title={
                                            typeof stageItem === 'object' && stageItem.smart
                                              ? '智能养成关卡'
                                              : typeof stageItem === 'object' && stageItem.pinned
                                                ? '取消置顶'
                                                : '置顶'
                                          }
                                        >
                                          {(typeof stageItem === 'object' && stageItem.smart) ? (
                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                            </svg>
                                          ) : (
                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                                            </svg>
                                          )}
                                        </button>
                                        <input
                                          type="text"
                                          list="stage-suggestions"
                                          value={typeof stageItem === 'string' ? stageItem : stageItem.stage}
                                          onChange={(e) => {
                                            const newStages = [...(task.params.stages || [{ stage: '', times: '' }])];
                                            if (typeof newStages[stageIndex] === 'string') {
                                              newStages[stageIndex] = { stage: e.target.value, times: '' };
                                            } else {
                                              newStages[stageIndex] = { ...newStages[stageIndex], stage: e.target.value };
                                            }
                                            updateTaskParam(index, 'stages', newStages);
                                          }}
                                          placeholder={field.placeholder}
                                          disabled={isRunning || !task.enabled || (typeof stageItem === 'object' && stageItem.smart)}
                                          className="w-28 pl-7 pr-3 py-2 bg-transparent text-sm text-gray-900 dark:text-gray-200 focus:outline-none"
                                        />
                                        <datalist id="stage-suggestions">
                                          <option value="1-7">1-7 (固源岩)</option>
                                          <option value="4-6">4-6 (酮凝集)</option>
                                          <option value="S4-1">S4-1 (聚酸酯)</option>
                                          <option value="S5-9">S5-9 (异铁)</option>
                                          <option value="CE-6">CE-6 (龙门币)</option>
                                          <option value="LS-6">LS-6 (作战记录)</option>
                                          <option value="AP-5">AP-5 (采购凭证)</option>
                                          <option value="CA-5">CA-5 (技巧概要)</option>
                                          <option value="SK-5">SK-5 (碳)</option>
                                          <option value="PR-A-2">PR-A-2 (重装/医疗芯片组)</option>
                                          <option value="PR-B-2">PR-B-2 (狙击/术师芯片组)</option>
                                          <option value="PR-C-2">PR-C-2 (先锋/辅助芯片组)</option>
                                          <option value="PR-D-2">PR-D-2 (近卫/特种芯片组)</option>
                                          <option value="Annihilation">Annihilation (剿灭)</option>
                                          <option value="HD-1">HD-1 (活动)</option>
                                          <option value="HD-2">HD-2 (活动)</option>
                                          <option value="HD-3">HD-3 (活动)</option>
                                          <option value="HD-4">HD-4 (活动)</option>
                                          <option value="HD-5">HD-5 (活动)</option>
                                          <option value="HD-6">HD-6 (活动)</option>
                                          <option value="HD-7">HD-7 (活动)</option>
                                          <option value="HD-8">HD-8 (活动)</option>
                                          <option value="HD-9">HD-9 (活动)</option>
                                          <option value="HD-10">HD-10 (活动)</option>
                                        </datalist>
                                        <div className="w-px h-6 bg-white/20"></div>
                                        <input
                                          type="number"
                                          value={typeof stageItem === 'string' ? '' : (stageItem.times || '')}
                                          onChange={(e) => {
                                            const newStages = [...(task.params.stages || [{ stage: '', times: '' }])];
                                            const currentStage = newStages[stageIndex];
                                            if (typeof currentStage === 'string') {
                                              newStages[stageIndex] = { stage: currentStage, times: e.target.value };
                                            } else if (currentStage) {
                                              newStages[stageIndex] = { ...currentStage, times: e.target.value };
                                            }
                                            updateTaskParam(index, 'stages', newStages);
                                          }}
                                          placeholder=""
                                          disabled={isRunning || !task.enabled || (typeof stageItem === 'object' && stageItem.smart)}
                                          className="w-10 px-1 py-2 bg-transparent text-sm text-gray-900 dark:text-gray-200 text-center focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                          min="0"
                                        />
                                        <div className="flex flex-col border-l border-white/10 self-stretch overflow-hidden">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const newStages = [...(task.params.stages || [{ stage: '', times: '' }])];
                                              const currentItem = newStages[stageIndex];
                                              if (!currentItem) return;
                                              const currentValue = typeof currentItem === 'string' ? 0 : (Number(currentItem.times) || 0);
                                              if (typeof currentItem === 'string') {
                                                newStages[stageIndex] = { stage: currentItem, times: (currentValue + 1).toString() };
                                              } else {
                                                newStages[stageIndex] = { ...currentItem, times: (currentValue + 1).toString() };
                                              }
                                              updateTaskParam(index, 'stages', newStages);
                                            }}
                                            disabled={isRunning || !task.enabled || (typeof stageItem === 'object' && stageItem.smart)}
                                            className="flex-1 px-1.5 bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                                          >
                                            <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                                            </svg>
                                          </button>
                                          <div className="w-full h-px bg-white/10"></div>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const newStages = [...(task.params.stages || [{ stage: '', times: '' }])];
                                              const currentItem = newStages[stageIndex];
                                              if (!currentItem) return;
                                              const currentValue = typeof currentItem === 'string' ? 0 : (Number(currentItem.times) || 0);
                                              if (currentValue > 0) {
                                                if (typeof currentItem === 'string') {
                                                  newStages[stageIndex] = { stage: currentItem, times: (currentValue - 1).toString() };
                                                } else {
                                                  newStages[stageIndex] = { ...currentItem, times: (currentValue - 1).toString() };
                                                }
                                                updateTaskParam(index, 'stages', newStages);
                                              }
                                            }}
                                            disabled={isRunning || !task.enabled || (typeof stageItem === 'object' && stageItem.smart)}
                                            className="flex-1 px-1.5 bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                                          >
                                            <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                            </svg>
                                          </button>
                                        </div>
                                      </div>
                                      {(task.params.stages || [{ stage: '', times: '' }]).length > 1 && !(typeof stageItem === 'object' && stageItem.smart) && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const newStages = (task.params.stages || [{ stage: '', times: '' }]).filter((_, i) => i !== stageIndex);
                                            updateTaskParam(index, 'stages', newStages.length > 0 ? newStages : [{ stage: '', times: '' }]);
                                          }}
                                          disabled={isRunning || !task.enabled}
                                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                                          title="删除此关卡"
                                        >
                                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                          </svg>
                                        </button>
                                      )}
                                        </div>
                                      </div>
                                      {/* 智能养成干员提示 - 只在最后一个智能养成关卡下显示 */}
                                      {(() => {
                                        // 找到所有智能养成关卡的索引
                                        const smartStageIndices = (task.params.stages || [])
                                          .map((s: any, idx: number) => ({ stage: s, index: idx }))
                                          .filter((item: any) => typeof item.stage === 'object' && item.stage.smart)
                                          .map((item: any) => item.index);

                                        // 检查当前是否是最后一个智能养成关卡
                                        const isLastSmartStage = smartStageIndices.length > 0 &&
                                          stageIndex === smartStageIndices[smartStageIndices.length - 1];

                                        // 只在最后一个智能养成关卡下显示
                                        return isLastSmartStage &&
                                          typeof stageItem === 'object' &&
                                          stageItem.smart &&
                                          stageItem.trainingOperators &&
                                          stageItem.trainingOperators.length > 0 && (
                                          <div className="flex items-center space-x-2 -mb-1 mt-1">
                                            <div style={{ width: '80px', flexShrink: 0 }}></div>
                                            <div className="text-xs brand-chip px-3 py-1.5 rounded-lg flex items-center space-x-1.5">
                                              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                              </svg>
                                              <span className="font-medium">正在养成:</span>
                                              <span>{stageItem.trainingOperators.join('、')}</span>
                                            </div>
                                          </div>
                                        );
                                      })()}
                                    </div>
                                  ))}
                                  <div className="flex items-center space-x-2">
                                    <div style={{ width: '80px', flexShrink: 0 }}></div>
                                    <div className="inline-flex space-x-2">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const currentStages = task.params.stages || [{ stage: '', times: '' }];
                                          updateTaskParam(index, 'stages', [...currentStages, { stage: '', times: '' }]);
                                        }}
                                        disabled={isRunning || !task.enabled}
                                        className="flex items-center justify-center space-x-1 border border-dashed border-gray-300 dark:border-gray-600 hover:border-[var(--app-accent)] rounded-xl py-1.5 px-3 text-sm text-gray-500 dark:text-gray-400 hover:text-[var(--app-accent)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed control-surface"
                                      >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                                        </svg>
                                        <span className="pointer-events-none">添加关卡</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          try {
                                            // 获取当前关卡列表
                                            const currentStages = task.params.stages || [{ stage: '', times: '' }];

                                            // 检查是否已有智能关卡
                                            const hasSmartStages = currentStages.some(s => typeof s === 'object' && s.smart);

                                            if (hasSmartStages) {
                                              // 如果已有智能关卡，则移除所有智能关卡
                                              const pinnedStages = currentStages.filter(s =>
                                                typeof s === 'object' && s.pinned && s.stage && s.stage.trim()
                                              );
                                              const normalStages = currentStages.filter(s =>
                                                (typeof s === 'string' && s.trim()) ||
                                                (typeof s === 'object' && !s.pinned && !s.smart && s.stage && s.stage.trim())
                                              );

                                              const allStages = [...pinnedStages, ...normalStages];
                                              updateTaskParam(index, 'stages', allStages.length > 0 ? allStages : [{ stage: '', times: '' }]);
                                              showSuccess('已移除智能养成关卡');
                                              return;
                                            }

                                            // 如果没有智能关卡，则添加
                                            // 从智能养成加载刷取计划
                                            const result = await maaApi.loadUserConfig('training-queue');
                                            if (!result.success || !result.data || !result.data.queue || result.data.queue.length === 0) {
                                              showError('智能养成队列为空，请先添加干员');
                                              return;
                                            }

                                            // 生成刷取计划
                                            const planResult = await maaApi.generateTrainingPlan('current');
                                            if (!planResult.success || !planResult.data) {
                                              showError('生成刷取计划失败');
                                              return;
                                            }

                                            const plan = planResult.data;
                                            if (!plan.stages || plan.stages.length === 0) {
                                              showSuccess('当前干员材料已集齐！');
                                              return;
                                            }

                                            // 获取正在养成的干员名称
                                            const trainingOperatorNames = plan.operators && plan.operators.length > 0
                                              ? plan.operators.map((op: any) => op.name)
                                              : [];

                                            // 将刷取计划转换为关卡列表，标记为智能养成
                                            const newStages = plan.stages.map((stage: any) => ({
                                              stage: stage.stage,
                                              times: stage.totalTimes.toString(),
                                              smart: true, // 标记为智能养成关卡
                                              trainingOperators: trainingOperatorNames // 添加干员信息
                                            }));

                                            // 分类：置顶关卡、普通关卡
                                            const pinnedStages = currentStages.filter((s): s is StageConfig =>
                                              typeof s === 'object' && s.pinned === true && !!s.stage && s.stage.trim() !== ''
                                            );
                                            const normalStages = currentStages.filter((s): s is string | StageConfig =>
                                              (typeof s === 'string' && s.trim() !== '') ||
                                              (typeof s === 'object' && !s.pinned && !s.smart && !!s.stage && s.stage.trim() !== '')
                                            );

                                            // 重新组合：置顶 -> 智能养成 -> 普通
                                            const allStages = [...pinnedStages, ...newStages, ...normalStages];

                                            updateTaskParam(index, 'stages', allStages);
                                            showSuccess(`已添加智能养成计划：${newStages.length} 个关卡`);
                                          } catch (error: unknown) {
                                            const errorMessage = error instanceof Error ? error.message : '未知错误'
                                            showError('操作失败: ' + errorMessage);
                                          }
                                        }}
                                        disabled={isRunning || !task.enabled}
                                        className={`flex items-center justify-center space-x-1 border border-dashed rounded-xl py-1.5 px-3 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                                          (task.params.stages || []).some(s => typeof s === 'object' && s.smart)
                                            ? 'border-[var(--app-accent)] brand-action-subtle'
                                            : 'border-[var(--app-border)] brand-chip hover:border-[var(--app-accent)]'
                                        }`}
                                      >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                          {(task.params.stages || []).some(s => typeof s === 'object' && s.smart) ? (
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                          ) : (
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l9-5-9-5-9 5 9 5z M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
                                          )}
                                        </svg>
                                        <span>
                                          {(task.params.stages || []).some(s => typeof s === 'object' && s.smart) ? '关闭养成' : '智能养成'}
                                        </span>
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ) : field.type === 'stage-with-times' ? (
                                <div className="flex items-center space-x-2">
                                  <label className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap w-20">{field.label}:</label>
                                  <div className="automation-composite-control flex items-center flex-1 max-w-[280px]">
                                    <input
                                      type="text"
                                      value={task.params[field.key] || ''}
                                      onChange={(e) => updateTaskParam(index, field.key, e.target.value)}
                                      placeholder={field.placeholder}
                                      disabled={isRunning || !task.enabled}
                                      className="flex-1 px-3 py-2 bg-transparent text-sm text-gray-900 dark:text-gray-200 focus:outline-none min-w-0"
                                    />
                                    <div className="w-px h-6 bg-white/20"></div>
                                    <input
                                      type="number"
                                      value={task.params.times || ''}
                                      onChange={(e) => updateTaskParam(index, 'times', e.target.value)}
                                      placeholder=""
                                      disabled={isRunning || !task.enabled}
                                      className="w-16 px-2 py-2 bg-transparent text-sm text-gray-900 dark:text-gray-200 text-center focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                      min="0"
                                    />
                                    <div className="flex flex-col border-l border-white/10 self-stretch overflow-hidden">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const currentValue = Number(task.params.times) || 0;
                                          updateTaskParam(index, 'times', (currentValue + 1).toString());
                                        }}
                                        disabled={isRunning || !task.enabled}
                                        className="flex-1 px-1.5 bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center rounded-tr-xl"
                                      >
                                        <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                                        </svg>
                                      </button>
                                      <div className="w-full h-px bg-white/10"></div>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const currentValue = Number(task.params.times) || 0;
                                          if (currentValue > 0) {
                                            updateTaskParam(index, 'times', (currentValue - 1).toString());
                                          }
                                        }}
                                        disabled={isRunning || !task.enabled}
                                        className="flex-1 px-1.5 bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center rounded-br-xl"
                                      >
                                        <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                        </svg>
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ) : field.type === 'star-select' ? (
                                <div>
                                  <label className="text-sm text-gray-600 dark:text-gray-400 block mb-2">{field.label}:</label>
                                  <div className="flex items-center space-x-2 flex-wrap">
                                    {[3, 4, 5, 6].map(star => {
                                      const currentValue = Array.isArray(task.params[field.key]) ? task.params[field.key] : [];
                                      const isChecked = currentValue.includes(star);
                                      return (
                                        <label key={star} className="flex items-center space-x-1 text-sm text-gray-700 dark:text-gray-300 cursor-pointer group">
                                          <input
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={(e) => {
                                              const newValue = e.target.checked
                                                ? [...currentValue, star].sort()
                                                : currentValue.filter((s: number) => s !== star);
                                              updateTaskParam(index, field.key, newValue);
                                            }}
                                            disabled={isRunning || !task.enabled}
                                            className="custom-checkbox cursor-pointer"
                                          />
                                          <span className="group-hover:text-[var(--app-accent)] transition-colors flex items-center space-x-1">
                                            <span>{star}</span>
                                            <svg className="w-3.5 h-3.5 brand-text" fill="currentColor" viewBox="0 0 20 20">
                                              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                            </svg>
                                          </span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                  {task.id === 'recruit' && field.key === 'select' && Array.isArray(task.params.select) && task.params.select.includes(6) && (
                                    <div className="mt-2 rounded-xl px-3 py-2 text-xs brand-chip">
                                      已开启 6 星自动公招：遇到高级资深干员等高价值标签时，会优先保留并自动选择。
                                    </div>
                                  )}
                                </div>
                              ) : field.type === 'facility-select' ? (
                                <div>
                                  <label className="text-sm text-gray-600 dark:text-gray-400 block mb-2">{field.label}:</label>
                                  <div className="grid grid-cols-2 gap-2">
                                    {[
                                      { value: 'Mfg', label: '制造站' },
                                      { value: 'Trade', label: '贸易站' },
                                      { value: 'Power', label: '发电站' },
                                      { value: 'Control', label: '控制中枢' },
                                      { value: 'Reception', label: '会客室' },
                                      { value: 'Office', label: '办公室' },
                                      { value: 'Dorm', label: '宿舍' },
                                      { value: 'Processing', label: '加工站' },
                                      { value: 'Training', label: '训练室' }
                                    ].map(facility => {
                                      const currentValue = Array.isArray(task.params[field.key]) ? task.params[field.key] : [];
                                      const isChecked = currentValue.includes(facility.value);
                                      return (
                                        <label key={facility.value} className="flex items-center space-x-1 text-sm text-gray-700 dark:text-gray-300 cursor-pointer group">
                                          <input
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={(e) => {
                                              const newValue = e.target.checked
                                                ? [...currentValue, facility.value]
                                                : currentValue.filter((f: string) => f !== facility.value);
                                              updateTaskParam(index, field.key, newValue);
                                            }}
                                            disabled={isRunning || !task.enabled}
                                            className="custom-checkbox cursor-pointer"
                                          />
                                          <span className="group-hover:text-[var(--app-accent)] transition-colors">{facility.label}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : field.type === 'select' ? (
                                <div className="flex items-center space-x-2">
                                  <label className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap w-20">{field.label}:</label>
                                  <div className="automation-select-control">
                                    <select
                                      value={task.params[field.key] || (Array.isArray(field.options) && field.options.length > 0 ? (typeof field.options[0] === 'object' ? field.options[0].value : field.options[0]) : '')}
                                      onChange={(e) => updateTaskParam(index, field.key, e.target.value)}
                                      disabled={isRunning || !task.enabled}
                                    >
                                      {Array.isArray(field.options) && field.options.map((opt) => {
                                        const value = typeof opt === 'object' ? opt.value : opt
                                        const label = typeof opt === 'object' ? opt.label : opt
                                        return <option key={String(value)} value={String(value)}>{label}</option>
                                      })}
                                    </select>
                                    <ChevronDown size={15} strokeWidth={2} aria-hidden="true" />
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center space-x-2">
                                  <label className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap w-20">{field.label}:</label>
                                  {field.type === 'number' ? (
                                    <div className="number-input-wrapper flex-1">
                                      <input
                                        type="number"
                                        value={task.params[field.key] || ''}
                                        onChange={(e) => updateTaskParam(index, field.key, e.target.value)}
                                        placeholder={field.placeholder}
                                        step={field.step}
                                        min={field.min}
                                        max={field.max}
                                        disabled={isRunning || !task.enabled}
                                        className="automation-number-control"
                                      />
                                      <div className="number-input-controls">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const currentValue = Number(task.params[field.key]) || 0;
                                            const step = Number(field.step) || 1;
                                            const max = field.max !== undefined ? Number(field.max) : Infinity;
                                            const newValue = Math.min(currentValue + step, max);
                                            updateTaskParam(index, field.key, newValue.toString());
                                          }}
                                          disabled={isRunning || !task.enabled}
                                        >
                                          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                                          </svg>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const currentValue = Number(task.params[field.key]) || 0;
                                            const step = Number(field.step) || 1;
                                            const min = field.min !== undefined ? Number(field.min) : -Infinity;
                                            const newValue = Math.max(currentValue - step, min);
                                            updateTaskParam(index, field.key, newValue.toString());
                                          }}
                                          disabled={isRunning || !task.enabled}
                                        >
                                          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                          </svg>
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <input
                                      type={field.type}
                                      value={task.params[field.key] || ''}
                                      onChange={(e) => updateTaskParam(index, field.key, e.target.value)}
                                      placeholder={field.placeholder}
                                      step={field.step}
                                      min={field.min}
                                      max={field.max}
                                      disabled={isRunning || !task.enabled}
                                      className="automation-text-control"
                                    />
                                  )}
                                </div>
                              )}
                              {field.helper && (
                                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 flex items-start gap-1.5">
                                  <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
                                  </svg>
                                  <span>{field.helper}</span>
                                </p>
                              )}
                            </div>
                            );
                          })}
                        </div>
                      )}

                      {task.commandId === 'fight' && (
                        <details className="group mt-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] px-3 py-2">
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-gray-700 marker:hidden dark:text-gray-200 [&::-webkit-details-marker]:hidden">
                            <span className="flex items-center gap-2">
                              <SlidersHorizontal size={15} strokeWidth={1.9} />
                              高级设置
                            </span>
                            <ChevronDown size={15} strokeWidth={2} className="transition-transform group-open:rotate-180" />
                          </summary>

                          <div className="mt-3 space-y-3 border-t border-[var(--app-border)] pt-3">
                            <div className="flex items-center gap-2">
                              <label className="w-24 shrink-0 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">闪退重启:</label>
                              <div className="automation-select-control min-w-0 flex-1">
                                <select
                                  value={task.params.clientType || ''}
                                  onChange={(e) => updateTaskParam(index, 'clientType', e.target.value)}
                                  disabled={isRunning || !task.enabled}
                                >
                                  <option value="">不启用</option>
                                  <option value="Official">官服</option>
                                  <option value="Bilibili">B服</option>
                                  <option value="YoStarEN">美服</option>
                                  <option value="YoStarJP">日服</option>
                                  <option value="YoStarKR">韩服</option>
                                  <option value="Txwy">繁中服</option>
                                </select>
                                <ChevronDown size={15} strokeWidth={2} aria-hidden="true" />
                              </div>
                            </div>
                            <p className="text-xs text-gray-400 dark:text-gray-500">选择客户端后，游戏闪退时会自动重新启动。</p>

                            <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                              <input
                                type="checkbox"
                                checked={Boolean(task.params.DrGrandet)}
                                onChange={(e) => updateTaskParam(index, 'DrGrandet', e.target.checked)}
                                disabled={isRunning || !task.enabled}
                                className="custom-checkbox mt-0.5 cursor-pointer"
                              />
                              <span>
                                <span className="block">葛朗台碎石模式</span>
                                <span className="mt-0.5 block text-xs text-gray-400 dark:text-gray-500">使用源石前等待自然恢复 1 点理智，尽量减少碎石浪费。</span>
                              </span>
                            </label>

                            <section className="space-y-2 border-t border-[var(--app-border)] pt-3">
                              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                                <input
                                  type="checkbox"
                                  checked={Boolean(task.params.report_to_penguin)}
                                  onChange={(e) => updateTaskParam(index, 'report_to_penguin', e.target.checked)}
                                  disabled={isRunning || !task.enabled}
                                  className="custom-checkbox cursor-pointer"
                                />
                                汇报掉落至企鹅物流
                              </label>
                              {task.params.report_to_penguin && (
                                <div className="flex items-center gap-2 pl-6">
                                  <label className="w-20 shrink-0 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">用户 ID:</label>
                                  <input
                                    type="text"
                                    value={task.params.penguin_id || ''}
                                    onChange={(e) => updateTaskParam(index, 'penguin_id', e.target.value)}
                                    placeholder="留空则匿名汇报"
                                    disabled={isRunning || !task.enabled}
                                    className="automation-text-control min-w-0 flex-1"
                                  />
                                </div>
                              )}
                            </section>

                            <section className="space-y-2 border-t border-[var(--app-border)] pt-3">
                              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                                <input
                                  type="checkbox"
                                  checked={Boolean(task.params.report_to_yituliu)}
                                  onChange={(e) => updateTaskParam(index, 'report_to_yituliu', e.target.checked)}
                                  disabled={isRunning || !task.enabled}
                                  className="custom-checkbox cursor-pointer"
                                />
                                汇报掉落至一图流
                              </label>
                              {task.params.report_to_yituliu && (
                                <div className="flex items-center gap-2 pl-6">
                                  <label className="w-20 shrink-0 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">用户 ID:</label>
                                  <input
                                    type="text"
                                    value={task.params.yituliu_id || ''}
                                    onChange={(e) => updateTaskParam(index, 'yituliu_id', e.target.value)}
                                    placeholder="留空则匿名汇报"
                                    disabled={isRunning || !task.enabled}
                                    className="automation-text-control min-w-0 flex-1"
                                  />
                                </div>
                              )}
                            </section>
                          </div>
                        </details>
                      )}

                      {task.commandId === 'infrast' && (
                        <details className="group mt-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] px-3 py-2">
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-gray-700 marker:hidden dark:text-gray-200 [&::-webkit-details-marker]:hidden">
                            <span className="flex items-center gap-2">
                              <SlidersHorizontal size={15} strokeWidth={1.9} />
                              高级设置
                            </span>
                            <ChevronDown size={15} strokeWidth={2} className="transition-transform group-open:rotate-180" />
                          </summary>

                          <div className="mt-3 space-y-3 border-t border-[var(--app-border)] pt-3">
                            {Array.isArray(task.params.facility) && task.params.facility.includes('Dorm') && (
                              <section className="space-y-2">
                                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400">宿舍</h4>
                                <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(task.params.dorm_notstationed_enabled)}
                                    onChange={(e) => updateTaskParam(index, 'dorm_notstationed_enabled', e.target.checked)}
                                    disabled={isRunning || !task.enabled}
                                    className="custom-checkbox cursor-pointer"
                                  />
                                  使用“未进驻”筛选
                                </label>
                                <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(task.params.dorm_trust_enabled)}
                                    onChange={(e) => updateTaskParam(index, 'dorm_trust_enabled', e.target.checked)}
                                    disabled={isRunning || !task.enabled}
                                    className="custom-checkbox cursor-pointer"
                                  />
                                  空位补入未满信赖干员
                                </label>
                              </section>
                            )}

                            {Array.isArray(task.params.facility) && task.params.facility.includes('Reception') && (
                              <section className="space-y-2 border-t border-[var(--app-border)] pt-3">
                                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400">会客室</h4>
                                <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(task.params.reception_message_board)}
                                    onChange={(e) => updateTaskParam(index, 'reception_message_board', e.target.checked)}
                                    disabled={isRunning || !task.enabled}
                                    className="custom-checkbox cursor-pointer"
                                  />
                                  领取信息板信用
                                </label>
                                <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(task.params.reception_clue_exchange)}
                                    onChange={(e) => updateTaskParam(index, 'reception_clue_exchange', e.target.checked)}
                                    disabled={isRunning || !task.enabled}
                                    className="custom-checkbox cursor-pointer"
                                  />
                                  发起线索交流
                                </label>
                                <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(task.params.reception_send_clue)}
                                    onChange={(e) => updateTaskParam(index, 'reception_send_clue', e.target.checked)}
                                    disabled={isRunning || !task.enabled}
                                    className="custom-checkbox cursor-pointer"
                                  />
                                  自动赠送线索
                                </label>
                              </section>
                            )}

                            {Array.isArray(task.params.facility) && task.params.facility.includes('Training') && (
                              <section className="space-y-2 border-t border-[var(--app-border)] pt-3">
                                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400">训练室</h4>
                                <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(task.params.continue_training)}
                                    onChange={(e) => updateTaskParam(index, 'continue_training', e.target.checked)}
                                    disabled={isRunning || !task.enabled}
                                    className="custom-checkbox cursor-pointer"
                                  />
                                  完成后继续专精
                                </label>
                              </section>
                            )}
                          </div>
                        </details>
                      )}

                      {task.commandId === 'recruit' && (
                        <details className="group mt-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] px-3 py-2">
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-gray-700 marker:hidden dark:text-gray-200 [&::-webkit-details-marker]:hidden">
                            <span className="flex items-center gap-2">
                              <SlidersHorizontal size={15} strokeWidth={1.9} />
                              高级设置
                            </span>
                            <ChevronDown size={15} strokeWidth={2} className="transition-transform group-open:rotate-180" />
                          </summary>

                          <div className="mt-3 space-y-3 border-t border-[var(--app-border)] pt-3">
                            <div className="flex items-center gap-2">
                              <label className="w-20 shrink-0 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">额外标签:</label>
                              <div className="automation-select-control min-w-0 flex-1">
                                <select
                                  value={String(task.params.extra_tags_mode ?? 0)}
                                  onChange={(e) => updateTaskParam(index, 'extra_tags_mode', Number(e.target.value))}
                                  disabled={isRunning || !task.enabled}
                                >
                                  <option value="0">标准选择</option>
                                  <option value="1">选满 3 个标签</option>
                                  <option value="2">尽量多选高星标签</option>
                                </select>
                                <ChevronDown size={15} strokeWidth={2} aria-hidden="true" />
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <label className="w-20 shrink-0 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">三星首选:</label>
                              <input
                                type="text"
                                value={Array.isArray(task.params.first_tags) ? task.params.first_tags.join(',') : (task.params.first_tags || '')}
                                onChange={(e) => updateTaskParam(index, 'first_tags', e.target.value)}
                                placeholder="近卫干员,治疗"
                                disabled={isRunning || !task.enabled}
                                className="automation-text-control min-w-0 flex-1"
                              />
                            </div>
                            <p className="text-xs text-gray-400 dark:text-gray-500">仅在三星组合中优先选择，多个标签用逗号分隔。</p>

                            <div>
                              <label className="mb-2 block text-sm text-gray-600 dark:text-gray-400">招募时长:</label>
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {[3, 4].map(star => {
                                  const key = String(star)
                                  const recruitmentTime = task.params.recruitment_time || { '3': 540, '4': 540 }
                                  return (
                                    <label key={star} className="flex min-w-0 items-center gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-2.5 py-2">
                                      <span className="shrink-0 text-sm font-medium text-gray-700 dark:text-gray-200">{star} 星</span>
                                      <input
                                        type="number"
                                        value={recruitmentTime[key] ?? 540}
                                        onChange={(e) => updateTaskParam(index, 'recruitment_time', { ...recruitmentTime, [key]: e.target.value })}
                                        onBlur={(e) => {
                                          const rawValue = Number(e.target.value)
                                          const normalizedValue = Number.isFinite(rawValue)
                                            ? Math.min(540, Math.max(60, Math.round(rawValue / 10) * 10))
                                            : 540
                                          updateTaskParam(index, 'recruitment_time', { ...recruitmentTime, [key]: normalizedValue })
                                        }}
                                        min="60"
                                        max="540"
                                        step="10"
                                        disabled={isRunning || !task.enabled}
                                        className="min-w-0 flex-1 bg-transparent text-right text-sm text-gray-900 outline-none dark:text-gray-100"
                                      />
                                      <span className="shrink-0 text-xs text-gray-400">分钟</span>
                                    </label>
                                  )
                                })}
                              </div>
                              <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">可设置 60 至 540 分钟，按 10 分钟调整；五星和六星固定为 540 分钟。</p>
                            </div>
                          </div>
                        </details>
                      )}

                      {/* 启动游戏任务的测试连接按钮 */}
                      {task.commandId === 'startup' && (
                        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-white/10">
                          <Button
                            type="button"
                            fullWidth
                            size="md"
                            variant="secondary"
                            onClick={() => void testConnection(task.id)}
                            disabled={isRunning || !task.enabled || testingConnectionTaskId !== null}
                            loading={isTestingConnection}
                            loadingText="正在检查"
                            statusKey={isTestingConnection ? 'testing' : connectionFeedback?.success ? 'success' : connectionFeedback ? 'error' : 'idle'}
                            icon={connectionFeedback?.success
                              ? <CheckCircle2 size={16} strokeWidth={2.2} aria-hidden="true" />
                              : connectionFeedback
                                ? <AlertTriangle size={16} strokeWidth={2.2} aria-hidden="true" />
                                : <Cable size={16} strokeWidth={2.1} aria-hidden="true" />}
                            aria-busy={isTestingConnection}
                            className={`automation-test-connection${isTestingConnection ? ' is-testing' : ''}`}
                          >
                            {connectionFeedback ? '重新测试' : '测试连接'}
                          </Button>

                          {/* 连接状态显示 */}
                          <AnimatePresence initial={false}>
                            {connectionFeedback && (
                              <motion.div
                                key={task.id}
                                initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, height: 0, y: -6 }}
                                animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, height: 'auto', y: 0 }}
                                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, height: 0, y: -4 }}
                                transition={{ duration: shouldReduceMotion ? 0.08 : 0.18, ease: 'easeOut' }}
                                className={`app-info-card mt-3 flex min-w-0 items-start gap-2 overflow-hidden text-sm ${connectionFeedback.success ? 'status-success' : 'status-danger'}`}
                                role={connectionFeedback.success ? 'status' : 'alert'}
                                aria-live={connectionFeedback.success ? 'polite' : undefined}
                              >
                                {connectionFeedback.success
                                  ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" strokeWidth={2.2} aria-hidden="true" />
                                  : <AlertTriangle size={18} className="mt-0.5 shrink-0" strokeWidth={2.2} aria-hidden="true" />}
                                <span className="min-w-0 break-words leading-5">{connectionFeedback.message}</span>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      )}
                    </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
        </div>
      </div>

    </>
  )
}
