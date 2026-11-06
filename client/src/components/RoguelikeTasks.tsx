import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Check, Play, Square } from 'lucide-react'
import { maaApi } from '../services/api'
import { PageHeader, Input, Select, Button, SmoothPanel, Switch, CjkText, TruncatedText } from './common'
import { keepNumberWithUnit } from '../utils/typography'
import { useStatusStore } from '../store/statusStore'
import { useRunStore } from '../store/runStore'
import FloatingStatusIndicator from './FloatingStatusIndicator'
import ScreenMonitor from './ScreenMonitor'
import { useFluidTabIndicator } from '../hooks/useFluidTabIndicator'
import { waitForTaskIdle } from '../utils/taskStatus'
import type {
  RoguelikeTask,
  RoguelikeAdvancedOption,
  RoguelikeTaskInputs,
  RoguelikeAdvancedParams,
  RoguelikeCoreChar
} from '@/types/components'
import { useAutomationAvailability } from '../hooks/useBackendStatusMonitor'
import {
  getRoguelikeModeChoices,
  getRoguelikeRoleChoices,
  getRoguelikeSquadChoices,
  isRoguelikeOptionVisible,
} from '../utils/roguelikeStrategy'

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
    { value: 'BlackFlow', label: '黑流树海' },
  ],
  reclamation: [
    { value: 'Tales', label: '沙洲遗闻' },
    { value: 'RelaunchAnchor', label: '重启锚点' },
  ],
}

const COLLECTIBLE_START_REWARDS = [
  { key: 'hot_water', label: '热水壶' },
  { key: 'shield', label: '护盾' },
  { key: 'ingot', label: '源石锭' },
  { key: 'hope', label: '希望' },
  { key: 'random', label: '随机奖励' },
  { key: 'key', label: '钥匙（水月）' },
  { key: 'dice', label: '骰子（水月）' },
  { key: 'ideas', label: '2\u00A0构想（萨卡兹）' },
  { key: 'ticket', label: '票券（界园）' },
]

const BLACKFLOW_REWARDS = [
  { value: 1, label: '未编号物' },
  { value: 2, label: '调查预付款' },
  { value: 4, label: '空间租赁' },
  { value: 8, label: '退行补偿' },
  { value: 16, label: '林间代步' },
  { value: 32, label: '巢寄生' },
  { value: 64, label: '襁褓天马' },
  { value: 128, label: '襁褓骏鹰' },
  { value: 256, label: '襁褓巨龙' },
  { value: 512, label: '襁褓九头蛇' },
  { value: 1024, label: '襁褓白泽' },
  { value: 2048, label: '襁褓金乌' },
]

const splitCommaList = (value: unknown): string[] => (
  typeof value === 'string'
    ? value.split(',').map(item => item.trim()).filter(Boolean)
    : []
)

export default function RoguelikeTasks() {
  const currentRun = useRunStore(state => state.run)
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
            const elapsedMinutes = (Date.now() - (startTime ?? 0)) / 1000 / 60
            setIsRunning(true)
            if (elapsedMinutes > 5) {
              setStatusMessage(`${taskName} 可能已完成（${keepNumberWithUnit(`已运行 ${Math.floor(elapsedMinutes)} 分钟`)}）`)
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
                if (statusResult.success && statusResult.data?.isRunning === false) {
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
        const serverConfig = await maaApi.loadUserConfig<{
          taskInputs?: RoguelikeTaskInputs
          advancedParams?: RoguelikeAdvancedParams
        }>('roguelike-tasks')
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
      hasAdvanced: true,
      description: '自动刷集成战略（肉鸽），支持多个主题'
    },
    { 
      id: 'reclamation', 
      name: '生息演算', 
      command: 'reclamation', 
      placeholder: '输入主题代号',
      hasAdvanced: true,
      description: '自动生息演算模式'
    },
  ]

  const getAdvancedOptions = (taskId: string): RoguelikeAdvancedOption[] => {
    const options: Record<string, RoguelikeAdvancedOption[]> = {
      roguelike: [
        { key: 'mode', label: '模式', type: 'select', options: [
          { value: '0', label: '刷分 / 奖励点数' },
          { value: '1', label: '刷源石锭' },
          { value: '4', label: '凹开局' },
          { value: '5', label: '刷坍缩范式（萨米）' },
          { value: '6', label: '月度小队' },
          { value: '7', label: '深入调查' },
          { value: '10001', label: '快速第一层（萨卡兹）' },
          { value: '20001', label: '常乐节点（界园）' },
          { value: '30001', label: '刷襁褓动物（黑流树海）' },
          { value: '30003', label: '刷开局（黑流树海）' },
        ], helper: '主题限制由 MaaCore 校验' },
        { key: 'difficulty', label: '难度', type: 'number', placeholder: '-1', helper: '-1 表示不指定；黑流树海实托邦需要 6\u00A0以上' },
        { key: 'squad', label: '起始分队', type: 'select', options: [] },
        { key: 'roles', label: '职业组', type: 'select', options: [], defaultValue: '稳扎稳打' },
        { key: 'coreCharList', label: '开局干员（最多 3\u00A0位）', type: 'core-char-list', helper: '按顺位招募；三个位置职业不能相同，助战可逐位开启' },
        { key: 'collectibleModeCoreCharList', label: '准备局开局干员（模式 30003）', type: 'core-char-list', helper: '不填则沿用主开局干员列表', modes: ['30003'] },
        { key: 'coreChar', label: '开局干员（兼容字段）', type: 'text', placeholder: '留空自动选择', helper: '仅在未填写上方干员列表时使用' },
        { key: 'useSupport', label: '兼容字段使用助战', type: 'checkbox', helper: '仅作用于上方兼容字段' },
        { key: 'useNonfriendSupport', label: '允许非好友助战', type: 'checkbox' },
        { key: 'startCount', label: '运行次数', type: 'number', placeholder: '无限' },
        { key: 'stopAtBoss', label: '最终 Boss 前停止', type: 'checkbox', modes: ['0'] },
        { key: 'stopAtMaxLevel', label: '肉鸽等级满后停止', type: 'checkbox' },
        { key: 'investmentEnabled', label: '投资源石锭', type: 'checkbox' },
        { key: 'investmentsCount', label: '投资次数', type: 'number', placeholder: '无限' },
        { key: 'stopWhenInvestmentFull', label: '投资满后停止', type: 'checkbox' },
        { key: 'investmentWithMoreScore', label: '投资后购物', type: 'checkbox', helper: '仅模式 1', modes: ['1'] },
        { key: 'collectibleModeStartList', label: '凹开局奖励（模式 4）', type: 'collectible-start-list', helper: '仅模式 4；勾选希望凹到的开局奖励' },
        { key: 'startWithEliteTwo', label: '凹精二直升', type: 'checkbox', helper: '仅模式 4', modes: ['4'] },
        { key: 'onlyStartWithEliteTwo', label: '只凹精二直升', type: 'checkbox', helper: '仅模式 4 且开启精二直升', modes: ['4'], requires: { key: 'startWithEliteTwo' } },
        { key: 'refreshTraderWithDice', label: '骰子刷新商店', type: 'checkbox', helper: '仅水月主题', themes: ['Mizuki'] },
        { key: 'firstFloorFoldartal', label: '第一层目标密文版', type: 'text', placeholder: '如：惊讶', themes: ['Sami'] },
        { key: 'startFoldartalList', label: '开局目标密文板', type: 'text', placeholder: '多个用逗号分隔', helper: '仅萨米模式 4，需生活至上分队', themes: ['Sami'], modes: ['4'] },
        { key: 'expectedCollapsalParadigms', label: '目标坍缩范式', type: 'text', placeholder: '目空一些,睁眼瞎', helper: '仅萨米模式 5，多个用逗号分隔', themes: ['Sami'], modes: ['5'] },
        { key: 'useFoldartal', label: '使用密文板', type: 'checkbox', helper: '仅萨米主题', themes: ['Sami'] },
        { key: 'checkCollapsalParadigms', label: '检测坍缩范式', type: 'checkbox', helper: '仅萨米主题', themes: ['Sami'] },
        { key: 'doubleCheckCollapsalParadigms', label: '坍缩范式防漏检测', type: 'checkbox', themes: ['Sami'], requires: { key: 'checkCollapsalParadigms' } },
        { key: 'monthlySquadAutoIterate', label: '月度小队自动切换', type: 'checkbox', modes: ['6'] },
        { key: 'monthlySquadCheckComms', label: '参考月度小队通信', type: 'checkbox', modes: ['6'] },
        { key: 'deepExplorationAutoIterate', label: '深入调查自动切换', type: 'checkbox', modes: ['7'] },
        { key: 'collectibleModeShopping', label: '烧水时购物', type: 'checkbox', modes: ['4', '30003'] },
        { key: 'collectibleModeSquad', label: '烧水分队', type: 'text', placeholder: '默认与起始分队同步', modes: ['4', '30003'] },
        { key: 'collectibleModeRoles', label: '烧水职业组', type: 'text', placeholder: '默认与职业组同步', modes: ['4', '30003'] },
        { key: 'startWithSeed', label: '固定种子', type: 'text', placeholder: '留空不启用', helper: '仅萨卡兹投资模式', themes: ['Sarkaz'], modes: ['1'] },
        { key: 'findPlayTimeTarget', label: '常乐节点目标', type: 'select', themes: ['JieGarden'], modes: ['20001'], options: [
          { value: '1', label: '令（掷地有声）' },
          { value: '2', label: '黍（种因得果）' },
          { value: '3', label: '年（三缺一）' },
        ], helper: '仅界园模式 20001，必填' },
        { key: 'blackflowStrategy', label: '黑流树海策略', type: 'select', themes: ['BlackFlow'], options: [
          { value: '', label: '按模式自动推断' },
          { value: 'baby_animal', label: '培育襁褓动物' },
          { value: 'investment', label: '投资路线' },
          { value: 'burn_with_investment', label: '投资后速通三层' },
          { value: 'burn', label: '速通三层' },
          { value: 'ending1', label: '第一结局' },
          { value: 'ending2', label: '第二结局' },
          { value: 'ending3', label: '第三结局' },
        ], helper: '仅刷等级模式 0；模式 30003 不读取' },
        { key: 'blackflowCultivationTarget', label: '培育目标', type: 'select', themes: ['BlackFlow'], modes: ['0'], options: [
          { value: 'swaddled_cat', label: '襁褓猫' },
          { value: 'swaddled_feathered_serpent', label: '襁褓羽蛇' },
          { value: 'swaddled_dog', label: '襁褓狗' },
          { value: 'swaddled_cerberus', label: '襁褓三头犬' },
        ], helper: '仅策略为培育襁褓动物时使用' },
        { key: 'blackflowStartAnimals', label: '模式 30003 襁褓动物', type: 'text', placeholder: 'swaddled_cat,swaddled_dog', helper: '0–2\u00A0项，羽蛇最多一项', modes: ['30003'] },
        { key: 'blackflowStartRewards', label: '模式 30003 开局奖励', type: 'blackflow-rewards', helper: '命中任意一项即完成目标局', modes: ['30003'] },
        { key: 'blackflowStartUtopia', label: '凹第一层实托邦', type: 'checkbox', helper: '难度 6\u00A0以上才会出现', modes: ['30003'] },
        { key: 'blackflowStartRewardPriority', label: '实托邦奖励优先级', type: 'text', placeholder: 'space_lease,unnumbered_item', helper: '凹实托邦时必填，多个用逗号分隔', modes: ['30003'] },
      ],
      reclamation: [
        { key: 'mode', label: '模式', type: 'select', defaultValue: '1', options: [
          { value: '0', label: '沙洲遗闻：刷繁荣度（无存档）' },
          { value: '1', label: '沙洲遗闻：制作工具刷繁荣度' },
          { value: '16', label: '重启锚点：RA-1 精耕细作' },
          { value: '32', label: '重启锚点：RA-15 圣聆初雪 60\u00A0杀' },
          { value: '48', label: '重启锚点：RA-4 维什戴尔 Boss' },
        ], helper: '模式需与上方主题匹配' },
        { key: 'toolsToCraft', label: '制作工具名称', type: 'text', placeholder: '荧光棒,发电机', helper: '仅沙洲遗闻模式 1，多个用逗号分隔', modes: ['1'] },
        { key: 'clearStore', label: '完成后清空商店', type: 'checkbox', helper: '仅沙洲遗闻模式 0', modes: ['0'] },
        { key: 'incrementMode', label: '点击方式', type: 'select', options: [
          { value: '0', label: '连点' },
          { value: '1', label: '长按' },
        ], helper: '仅沙洲遗闻' },
        { key: 'numCraftBatches', label: '制造轮数', type: 'number', placeholder: '16', helper: '仅沙洲遗闻', modes: ['1'] },
      ],
    }
    const selected = options[taskId] || []
    if (taskId === 'roguelike') {
      const theme = (taskInputs[taskId] || '').trim()
      const modeOption = selected.find(option => option.key === 'mode')
      if (modeOption) modeOption.options = getRoguelikeModeChoices(theme)
      const squadOption = selected.find(option => option.key === 'squad')
      if (squadOption) squadOption.options = getRoguelikeSquadChoices(theme)
      const rolesOption = selected.find(option => option.key === 'roles')
      if (rolesOption) rolesOption.options = getRoguelikeRoleChoices(theme)
    }
    return selected
  }

  const getVisibleAdvancedOptions = (taskId: string) => {
    const theme = (taskInputs[taskId] || '').trim()
    const advanced = advancedParams[taskId] || {}
    const mode = String(advanced.mode ?? (taskId === 'reclamation' ? 1 : 0))
    return getAdvancedOptions(taskId)
      .filter(option => isRoguelikeOptionVisible(option, theme, mode, advanced))
  }

  const buildTaskConfig = (task: RoguelikeTask) => {
    const advanced = advancedParams[task.id] || {}
    const theme = (taskInputs[task.id] || '').trim()
    if (!theme) throw new Error('请选择主题')

    const params: Record<string, unknown> = { theme }
    const modeDefault = task.id === 'reclamation' ? 1 : 0
    const mode = Number(advanced.mode ?? modeDefault)
    const optionMap = new Map(getAdvancedOptions(task.id).map(option => [option.key, option]))
    const modeKey = String(advanced.mode ?? modeDefault)
    const isVisible = (key: string) => isRoguelikeOptionVisible(optionMap.get(key), theme, modeKey, advanced)

    if (task.id === 'roguelike') {
      if (advanced.mode !== undefined && advanced.mode !== '') {
        const modeChoices = getRoguelikeModeChoices(theme)
        if (!modeChoices.some(choice => choice.value === String(advanced.mode))) {
          throw new Error('当前主题不支持所选模式，请重新选择')
        }
      }
      params.mode = Number.isFinite(mode) ? mode : 0

      const stringFields: Record<string, string> = {
        squad: 'squad',
        roles: 'roles',
        coreChar: 'core_char',
        firstFloorFoldartal: 'first_floor_foldartal',
        collectibleModeSquad: 'collectible_mode_squad',
        collectibleModeRoles: 'collectible_mode_roles',
        startWithSeed: 'start_with_seed',
        blackflowStrategy: 'blackflow_strategy',
        blackflowCultivationTarget: 'blackflow_cultivation_target',
      }
      Object.entries(stringFields).forEach(([key, param]) => {
        if (!isVisible(key)) return
        const value = advanced[key]
        if (typeof value === 'string' && value.trim()) params[param] = value.trim()
      })
      if (isVisible('roles') && !params.roles) params.roles = '稳扎稳打'

      const numberFields: Record<string, string> = {
        difficulty: 'difficulty',
        startCount: 'starts_count',
        investmentsCount: 'investments_count',
        findPlayTimeTarget: 'find_playTime_target',
      }
      Object.entries(numberFields).forEach(([key, param]) => {
        if (!isVisible(key)) return
        const value = advanced[key]
        if (value !== undefined && value !== '') {
          const numeric = Number(value)
          if (Number.isFinite(numeric)) params[param] = numeric
        }
      })

      const booleanFields: Record<string, string> = {
        useSupport: 'use_support',
        useNonfriendSupport: 'use_nonfriend_support',
        stopAtBoss: 'stop_at_final_boss',
        stopAtMaxLevel: 'stop_at_max_level',
        stopWhenInvestmentFull: 'stop_when_investment_full',
        investmentWithMoreScore: 'investment_with_more_score',
        startWithEliteTwo: 'start_with_elite_two',
        onlyStartWithEliteTwo: 'only_start_with_elite_two',
        refreshTraderWithDice: 'refresh_trader_with_dice',
        useFoldartal: 'use_foldartal',
        checkCollapsalParadigms: 'check_collapsal_paradigms',
        doubleCheckCollapsalParadigms: 'double_check_collapsal_paradigms',
        monthlySquadAutoIterate: 'monthly_squad_auto_iterate',
        monthlySquadCheckComms: 'monthly_squad_check_comms',
        deepExplorationAutoIterate: 'deep_exploration_auto_iterate',
        collectibleModeShopping: 'collectible_mode_shopping',
        blackflowStartUtopia: 'blackflow_start_utopia',
      }
      Object.entries(booleanFields).forEach(([key, param]) => {
        if (!isVisible(key)) return
        const value = advanced[key]
        if (typeof value === 'boolean') params[param] = value
      })
      params.investment_enabled = advanced.investmentEnabled !== false

      const listFields: Record<string, string> = {
        startFoldartalList: 'start_foldartal_list',
        expectedCollapsalParadigms: 'expected_collapsal_paradigms',
        blackflowStartAnimals: 'blackflow_start_animals',
        blackflowStartRewardPriority: 'blackflow_start_reward_priority',
      }
      Object.entries(listFields).forEach(([key, param]) => {
        if (!isVisible(key)) return
        const list = splitCommaList(advanced[key])
        if (list.length > 0) params[param] = list
      })

      if (isVisible('blackflowStartAnimals') && Number(params.mode) === 30003) {
        const animals = splitCommaList(advanced.blackflowStartAnimals)
        if (animals.length > 2) throw new Error('黑流树海襁褓动物最多选择 2 项')
        if (animals.filter(animal => animal === 'swaddled_feathered_serpent').length > 1) {
          throw new Error('襁褓羽蛇最多选择 1 项')
        }
        params.blackflow_start_animals = animals
      }

      const startList = advanced.collectibleModeStartList
      if (isVisible('collectibleModeStartList') && startList && typeof startList === 'object' && !Array.isArray(startList)) {
        params.collectible_mode_start_list = Object.fromEntries(
          COLLECTIBLE_START_REWARDS.map(reward => [reward.key, Boolean((startList as Record<string, boolean>)[reward.key])])
        )
      }

      const rewards = Number(advanced.blackflowStartRewards ?? 0)
      if (isVisible('blackflowStartRewards') && Number.isFinite(rewards) && rewards >= 0) {
        params.blackflow_start_rewards = rewards
      }

      const coreCharList = isVisible('coreCharList')
        ? (Array.isArray(advanced.coreCharList) ? advanced.coreCharList : [])
        .filter(entry => entry && typeof entry.name === 'string' && entry.name.trim())
        .slice(0, 3)
          .map(entry => ({ name: entry.name.trim(), use_support: Boolean(entry.use_support) }))
        : []
      if (coreCharList.length > 0) params.core_char_list = coreCharList

      const prepCoreCharList = isVisible('collectibleModeCoreCharList')
        ? (Array.isArray(advanced.collectibleModeCoreCharList) ? advanced.collectibleModeCoreCharList : [])
        .filter(entry => entry && typeof entry.name === 'string' && entry.name.trim())
        .slice(0, 3)
          .map(entry => ({ name: entry.name.trim(), use_support: Boolean(entry.use_support) }))
        : []
      if (prepCoreCharList.length > 0) params.collectible_mode_core_char_list = prepCoreCharList

      if ([30001, 30003].includes(Number(params.mode)) && theme !== 'BlackFlow') {
        throw new Error('该模式仅适用于黑流树海主题')
      }
      if (Number(params.mode) === 20001 && params.find_playTime_target === undefined) {
        params.find_playTime_target = 1
      }
      if (Number(params.mode) === 30003 && params.blackflow_start_utopia === true
        && !Array.isArray(params.blackflow_start_reward_priority)) {
        throw new Error('凹第一层实托邦需要填写奖励优先级')
      }
    } else {
      params.mode = Number.isFinite(mode) ? mode : 0
      const tools = splitCommaList(advanced.toolsToCraft)
      if (isVisible('toolsToCraft') && tools.length > 0) params.tools_to_craft = tools
      if (isVisible('clearStore') && typeof advanced.clearStore === 'boolean') params.clear_store = advanced.clearStore
      const incrementMode = Number(advanced.incrementMode ?? 0)
      if (isVisible('incrementMode') && Number.isFinite(incrementMode)) params.increment_mode = incrementMode
      const numBatches = Number(advanced.numCraftBatches ?? 0)
      if (isVisible('numCraftBatches') && Number.isFinite(numBatches) && numBatches > 0) params.num_craft_batches = numBatches

      if ([16, 32, 48].includes(Number(params.mode)) && theme !== 'RelaunchAnchor') {
        throw new Error('RA-1 / RA-15 / RA-4 模式需要选择「重启锚点」主题')
      }
      if ([0, 1].includes(Number(params.mode)) && theme === 'RelaunchAnchor') {
        throw new Error('「重启锚点」主题请选择 RA-1 / RA-15 / RA-4 模式')
      }
    }

    return {
      name: task.name,
      type: task.id === 'roguelike' ? 'Roguelike' : 'Reclamation',
      params,
    }
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
      const taskConfig = buildTaskConfig(task)
      const result = await maaApi.executeCommand(
        'run',
        [task.command],
        taskConfig,
        null,
        task.name,
        'roguelike',
        true
      )

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
      const result = await maaApi.stopTask(currentRun?.runId ?? null)
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

  const handleAdvancedChange = (
    taskId: string,
    key: string,
    value: string | number | boolean | RoguelikeCoreChar[] | Record<string, boolean>
  ) => {
    setAdvancedParams({
      ...advancedParams,
      [taskId]: {
        ...(advancedParams[taskId] || {}),
        [key]: value
      }
    })
  }

  const renderAdvancedOptions = (task: RoguelikeTask) => {
    const options = getVisibleAdvancedOptions(task.id)
    if (options.length === 0) return null

    const advanced = advancedParams[task.id] || {}
    const getCoreCharRows = (value: unknown) => Array.from({ length: 3 }, (_, index) => {
      const entry = Array.isArray(value) ? value[index] : undefined
      return {
        name: entry?.name || '',
        use_support: Boolean(entry?.use_support),
      }
    })
    const rewardMask = Number(advanced.blackflowStartRewards ?? 0)

    const updateCoreChar = (key: string, index: number, patch: Partial<RoguelikeCoreChar>) => {
      const next = getCoreCharRows(advanced[key]).map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row)
      handleAdvancedChange(task.id, key, next)
    }

    const renderCoreCharList = (option: RoguelikeAdvancedOption) => {
      const fieldSlug = option.key === 'coreCharList' ? 'core-char' : option.key
      const rows = getCoreCharRows(advanced[option.key])
      return (
        <fieldset>
          <legend className="roguelike-field-label mb-1 block">{option.label}</legend>
          <p className="mb-2 text-xs leading-5 text-secondary">{option.helper}</p>
          <div className="space-y-2">
            {rows.map((row, index) => (
              <div key={index} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
                <Input
                  id={`roguelike-${task.id}-${fieldSlug}-${index}`}
                  name={`maa-${task.id}-${fieldSlug}-${index}`}
                  type="text"
                  label={`第 ${index + 1} 顺位`}
                  value={row.name}
                  onChange={(value: string) => updateCoreChar(option.key, index, { name: value })}
                  placeholder="留空则自动选择"
                />
                <label
                  htmlFor={`roguelike-${task.id}-${fieldSlug}-${index}-support`}
                  className="flex min-h-11 items-center gap-2 whitespace-nowrap text-xs text-secondary"
                >
                  <input
                    id={`roguelike-${task.id}-${fieldSlug}-${index}-support`}
                    type="checkbox"
                    checked={row.use_support}
                    onChange={(event) => updateCoreChar(option.key, index, { use_support: event.target.checked })}
                    className="custom-checkbox cursor-pointer"
                  />
                  助战
                </label>
              </div>
            ))}
          </div>
        </fieldset>
      )
    }

    const renderBlackflowRewards = (option: RoguelikeAdvancedOption) => (
      <fieldset>
        <legend className="roguelike-field-label mb-1 block">{option.label}</legend>
        <p className="mb-2 text-xs leading-5 text-secondary">{option.helper}</p>
        <div className="grid grid-cols-2 gap-2">
          {BLACKFLOW_REWARDS.map(reward => (
            <label
              key={reward.value}
              htmlFor={`roguelike-${task.id}-blackflow-reward-${reward.value}`}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-[var(--app-border)] px-2 py-1.5 text-xs text-secondary"
            >
              <input
                id={`roguelike-${task.id}-blackflow-reward-${reward.value}`}
                type="checkbox"
                checked={(rewardMask & reward.value) === reward.value}
                onChange={(event) => {
                  const next = event.target.checked
                    ? rewardMask | reward.value
                    : rewardMask & ~reward.value
                  handleAdvancedChange(task.id, 'blackflowStartRewards', next)
                }}
                className="custom-checkbox cursor-pointer"
              />
              {reward.label}
            </label>
          ))}
        </div>
      </fieldset>
    )

    const renderCollectibleStartList = (option: RoguelikeAdvancedOption) => {
      const selected = advanced.collectibleModeStartList
      const selectedMap = selected && typeof selected === 'object' && !Array.isArray(selected)
        ? selected as Record<string, boolean>
        : {}
      return (
        <fieldset>
          <legend className="roguelike-field-label mb-1 block">{option.label}</legend>
          <p className="mb-2 text-xs leading-5 text-secondary">{option.helper}</p>
          <div className="grid grid-cols-2 gap-2">
            {COLLECTIBLE_START_REWARDS.map(reward => (
              <label
                key={reward.key}
                htmlFor={`roguelike-${task.id}-collectible-${reward.key}`}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-[var(--app-border)] px-2 py-1.5 text-xs text-secondary"
              >
                <input
                  id={`roguelike-${task.id}-collectible-${reward.key}`}
                  type="checkbox"
                  checked={Boolean(selectedMap[reward.key])}
                  onChange={(event) => handleAdvancedChange(task.id, 'collectibleModeStartList', {
                    ...selectedMap,
                    [reward.key]: event.target.checked,
                  })}
                  className="custom-checkbox cursor-pointer"
                />
                {reward.label}
              </label>
            ))}
          </div>
        </fieldset>
      )
    }

    const fieldOptions = options.filter(option => option.type !== 'checkbox')
    const toggleOptions = options.filter(option => option.type === 'checkbox')

    return (
      <>
        <div className="roguelike-field-grid">
          {fieldOptions.map(option => {
            const isCustom = option.type === 'core-char-list' || option.type === 'blackflow-rewards' || option.type === 'collectible-start-list'
            return (
              <div
                key={option.key}
                className={isCustom ? 'roguelike-custom-field' : undefined}
                style={isCustom ? { gridColumn: '1 / -1' } : undefined}
              >
                {option.type === 'select' && option.options ? (() => {
                  const choices = option.options ?? []
                  const value = String(advanced[option.key] ?? option.defaultValue ?? choices[0]?.value ?? '')
                  const withCurrent = value && !choices.some(choice => choice.value === value)
                    ? [...choices, { value, label: value }]
                    : choices
                  return (
                    <Select
                      id={`roguelike-${task.id}-${option.key}`}
                      name={`maa-${task.id}-${option.key}`}
                      label={option.label}
                      value={value}
                      onChange={(next: string) => handleAdvancedChange(task.id, option.key, next)}
                      options={withCurrent}
                    />
                  )
                })() : option.type === 'core-char-list' ? (
                  renderCoreCharList(option)
                ) : option.type === 'blackflow-rewards' ? (
                  renderBlackflowRewards(option)
                ) : option.type === 'collectible-start-list' ? (
                  renderCollectibleStartList(option)
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
                {!isCustom && option.helper && (
                  <p className="mt-1 text-xs leading-5 text-secondary">{option.helper}</p>
                )}
              </div>
            )
          })}
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
                  checked={option.key === 'investmentEnabled'
                    ? advanced[option.key] !== false
                    : Boolean(advanced[option.key])}
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
            <div className="app-workspace-segments app-liquid-tab-pill glass roguelike-mode-shell">
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
                <h3><CjkText>主题</CjkText></h3>
                <p>选择本次运行内容</p>
              </div>
              <span>{keepNumberWithUnit(`${THEME_PRESETS[activeMode].length} 个可用`)}</span>
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
                <h3><CjkText>策略设置</CjkText></h3>
                <TruncatedText as="p" tooltip={activeTask.name}>{activeTask.name}</TruncatedText>
              </div>
              <span>{keepNumberWithUnit(`${getVisibleAdvancedOptions(activeTask.id).length} 项`)}</span>
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
