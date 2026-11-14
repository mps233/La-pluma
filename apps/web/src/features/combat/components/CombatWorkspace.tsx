import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getErrorMessage } from '@/shared/api'
import { Button, ConfirmDialog } from '@/shared/components'
import { useAutomationAvailability, useStatusStore } from '@/features/runtime-status'
import { DeviceMonitorPanel } from '@/features/device-mirror'
import { isTerminalRunState } from '@/features/task-execution'
import { operBoxQueryOptions } from '@/features/game-data'
import { useUserConfig } from '@/features/user-config'
import { resetCopilotSetProgress as resetCopilotSetProgressRequest, uploadCopilotFile } from '../api'
import { useCombatExecution } from '../hooks/useCombatExecution'
import { useCopilotPreview } from '../hooks/useCopilotPreview'
import { useCopilotQueue } from '../hooks/useCopilotQueue'
import { useCopilotSearch, useParadoxSearch } from '../hooks/useCopilotSearch'
import {
  combatConfigAdapter,
  createDefaultCombatDraft,
  normalizeRaidValue,
} from '../model/combatConfig'
import type { CombatConfigDraft } from '../model/combatConfig'
import {
  buildCombatCommandArgs,
  buildCopilotSetExecutionOptions,
  normalizeFormationMode,
  toCopilotQueueFailurePolicy,
  toCopilotSetRunMode,
  validateCombatInput,
} from '../model/combatCommands'
import {
  pendingCopilotPlanIndexes,
  restorableCopilotIndexes,
  serializeCopilotSelection,
} from '../model/copilotSelection'
import { INVALID_COPILOT_URI_MESSAGE, resolveCopilotPreviewTarget } from '../model/copilotPreview'
import type { CopilotPreviewMode, CopilotPreviewOutcome } from '../model/copilotPreview'
import {
  buildCopilotQueueEntries,
  buildCopilotQueueEntryFromFile,
  checkedCopilotQueueEntries,
  COPILOT_QUEUE_LIMIT,
  toCopilotQueueRunEntries,
  type CopilotQueueEntry,
} from '../model/copilotQueue'
import { getCopilotQueueRetryModes } from '../model/copilotQueueRun'
import { collectCopilotItemErrors } from '../model/copilotDetail'
import type { CopilotDetailTarget } from '../model/copilotDetail'
import {
  DEFAULT_COPILOT_MATCH_MODES,
  normalizeCopilotSearchRequest,
  type CopilotSearchRequest,
} from '../model/copilotDiscovery'
import {
  readCopilotDiscoveryViewPreference,
  readCopilotMatchPreference,
  readCopilotOperatorFilterPreference,
} from '../model/copilotDiscoveryPreferences'
import type { OperatorSelection } from '../model/operatorFilter'
import { buildOperatorFilterOptions } from '../model/operatorFilter'
import { deriveCopilotSetView } from '../model/copilotSetView'
import { deriveExecutionProgress } from '../model/executionProgress'
import { createPanelStateStore } from '../model/panelState'
import {
  copilotStageCatalogQueryOptions,
  invalidateCopilotSetPlan,
  loadCopilotPreview as loadCopilotPreviewData,
} from '../model/queries'
import { normalizeCopilotInput, parseCopilotUri, splitCopilotInputToArgs } from '../utils/copilotUri'
import type {
  CombatMode,
  CombatTask,
  CopilotRaid,
  CopilotSearchOrder,
  CopilotSetExecutionMode,
  CopilotSetInfo,
  FormationMode,
} from '../types'
import CombatCopilotTaskPanel from './CombatCopilotTaskPanel'
import CombatExecutionProgressPanel from './CombatExecutionProgressPanel'
import CombatModeTabs from './CombatModeTabs'
import CombatSpecialTaskPanel from './CombatSpecialTaskPanel'
import { getCombatTask } from './CombatTaskCatalog'
import type {
  CombatCopilotConfig,
  CombatCopilotDetailSelection,
  CombatCopilotDiscoveryView,
  CombatCopilotExecutionActions,
  CombatCopilotFileImportProjection,
  CombatCopilotMatchSettings,
  CombatCopilotQueueProjection,
  CombatCopilotSearchProjection,
  CombatCopilotSelectionProjection,
  CombatExecutionActions,
  CombatParadoxSearchProjection,
} from './combatPanelTypes'
import { buildCopilotDiscoveryDetailTarget } from './copilotDiscoveryPresentation'

/** 协调器加载完成前的渲染默认值；与迁移前的初始 state 一致。 */
const DEFAULT_COMBAT_CONFIG = createDefaultCombatDraft()

const COPILOT_QUEUE_RUN_ID = 'copilot-queue'
const COPILOT_QUEUE_RUN_NAME = '作业队列'
const COPILOT_QUEUE_FULL_MESSAGE = `队列已满，最多 ${COPILOT_QUEUE_LIMIT} 个作业`

function previewMatchesInput(
  preview: CopilotSetInfo | null,
  input: string,
): preview is CopilotSetInfo {
  if (!preview) return false
  const parsed = parseCopilotUri(splitCopilotInputToArgs(input)[0] || '')
  if (!parsed || parsed.id !== preview.id) return false
  return preview.type === 'set' ? parsed.isSet || preview.autoAddS === true : !parsed.isSet
}

async function readCopilotFileText(file: File): Promise<string> {
  try {
    return await file.text()
  } catch {
    return ''
  }
}

export default function CombatWorkspace() {
  const setStatusMessage = useStatusStore(state => state.setMessage)
  const { isAvailable: automationAvailable, unavailableMessage } = useAutomationAvailability()
  const {
    draft: configDraft,
    syncState: configSyncState,
    error: configSyncError,
    update: updateConfig,
    channel: configChannel,
    retry: retryConfigSave,
  } = useUserConfig(combatConfigAdapter)
  const {
    taskInputs,
    advancedParams,
    autoFormation,
    copilotSetExecutionMode,
    copilotSetSelections,
  } = configDraft ?? DEFAULT_COMBAT_CONFIG
  const isRetryingConfigSave = configSyncState === 'saving'
  const queryClient = useQueryClient()
  const {
    preview,
    isLoading: isLoadingSet,
    load: loadCopilotPreview,
    refreshSet: refreshCopilotSet,
    resetProgressView: resetCopilotProgressView,
    cancel: cancelCopilotPreview,
    clear: clearPreviewData,
  } = useCopilotPreview()
  // 面板局部输入由工作区创建、面板订阅；工作区不订阅，因此输入不推动大列表渲染。
  const [panelStores] = useState(() => {
    const operatorPreference = readCopilotOperatorFilterPreference()
    const matchPreference = readCopilotMatchPreference()
    const viewPreference = readCopilotDiscoveryViewPreference()
    return {
      copilotPreviewMode: createPanelStateStore<CopilotPreviewMode>('auto'),
      copilotSearchKeyword: createPanelStateStore(''),
      copilotSearchLevel: createPanelStateStore(''),
      copilotSearchOperators: createPanelStateStore<OperatorSelection>(
        operatorPreference?.selection ?? { included: [], excluded: [] },
      ),
      copilotSearchOperatorsEnabled: createPanelStateStore<boolean>(operatorPreference?.enabled ?? true),
      copilotSearchOperatorsRemember: createPanelStateStore<boolean>(operatorPreference?.remember ?? true),
      copilotSearchOrder: createPanelStateStore<CopilotSearchOrder>('hot'),
      copilotSearchMatch: createPanelStateStore<CombatCopilotMatchSettings>({
        enabled: matchPreference?.enabled ?? false,
        modes: matchPreference?.modes ?? [...DEFAULT_COPILOT_MATCH_MODES],
      }),
      copilotSearchView: createPanelStateStore<CombatCopilotDiscoveryView>(viewPreference ?? 'grid'),
      paradoxSearchName: createPanelStateStore(''),
    }
  })
  const buildCopilotSearchRequest = useCallback(() => {
    const operatorSelection = panelStores.copilotSearchOperators.get()
    const operatorFilterEnabled = panelStores.copilotSearchOperatorsEnabled.get()
    return normalizeCopilotSearchRequest({
      includedOperators: operatorFilterEnabled ? operatorSelection.included : [],
      excludedOperators: operatorFilterEnabled ? operatorSelection.excluded : [],
    })
  }, [panelStores])
  const {
    result: copilotSearchResult,
    searching: isSearchingCopilot,
    refreshing: isRefreshingCopilot,
    search: searchCopilotJobs,
    loadMore: loadCopilotSearchPage,
    refreshDefault: refreshCopilotSearchDefault,
    cancel: cancelCopilotSearch,
    reset: resetCopilotSearch,
  } = useCopilotSearch(buildCopilotSearchRequest())
  const {
    result: paradoxSearchResult,
    searching: isSearchingParadox,
    search: searchParadoxJobs,
    cancel: cancelParadoxSearch,
  } = useParadoxSearch()
  const [activeCombatMode, setActiveCombatMode] = useState<CombatMode>('copilot')
  const [copilotDetail, setCopilotDetail] = useState<CombatCopilotDetailSelection | null>(null)
  const [pendingPreviewTarget, setPendingPreviewTarget] = useState<CopilotDetailTarget | null>(null)
  const pendingPreviewRequestRef = useRef(0)
  // 作废在途请求前先推进序号：被取代的响应不得清掉新请求的乐观目标。
  const clearCopilotPreview = useCallback(() => {
    pendingPreviewRequestRef.current += 1
    setPendingPreviewTarget(null)
    clearPreviewData()
    setCopilotDetail(current => current?.type === 'preview' ? null : current)
  }, [clearPreviewData])
  const [isResettingProgress, setIsResettingProgress] = useState(false)
  const [isImportingCopilotFile, setIsImportingCopilotFile] = useState(false)
  const [isAddingToQueue, setIsAddingToQueue] = useState(false)
  const [addingQueueUri, setAddingQueueUri] = useState<string | null>(null)
  const [submittedEntryIds, setSubmittedEntryIds] = useState<ReadonlySet<string>>(() => new Set())
  const queueAddControllerRef = useRef<AbortController | null>(null)
  const queue = useCopilotQueue()
  const { syncSet: syncQueueSet } = queue
  const importingCopilotFileRef = useRef(false)
  const [resetProgressDialogOpen, setResetProgressDialogOpen] = useState(false)
  const reconciledRunRef = useRef<string | null>(null)
  // 用户重置进度后，旧 run 的逐项结果不再属于当前预览。
  const [dismissedRunId, setDismissedRunId] = useState<string | null>(null)
  const [isDiscoveryOpen, setIsDiscoveryOpen] = useState(false)
  const stagesQuery = useQuery({
    ...copilotStageCatalogQueryOptions(),
    enabled: isDiscoveryOpen,
  })
  const operBoxQuery = useQuery({
    ...operBoxQueryOptions(),
    enabled: isDiscoveryOpen,
  })
  const operatorOptions = useMemo(
    () => buildOperatorFilterOptions(operBoxQuery.data ?? null),
    [operBoxQuery.data],
  )
  const ownedOperatorNames = useMemo(
    () => new Set(operatorOptions.filter(operator => operator.owned).map(operator => operator.name)),
    [operatorOptions],
  )
  const stages = stagesQuery.data ?? []
  const stagesError = stagesQuery.isError
    ? (stagesQuery.error instanceof Error && stagesQuery.error.message
        ? stagesQuery.error.message
        : '关卡目录加载失败')
    : null
  const operatorsError = operBoxQuery.isError
    ? (operBoxQuery.error instanceof Error && operBoxQuery.error.message
        ? operBoxQuery.error.message
        : '干员列表加载失败')
    : null

  useEffect(() => () => queueAddControllerRef.current?.abort(), [])

  const {
    isRunning,
    isWaitingForNext,
    isAutoStopping,
    isStopping,
    isContinuing,
    isSkipping,
    isSubmitting,
    setRun,
    queueRun,
    run: trackedRun,
    submitTask,
    submitSet,
    submitQueue,
    continueSet,
    continueQueue,
    skipQueueEntry,
    stop,
  } = useCombatExecution({
    notify: setStatusMessage,
    stopOnFailure: advancedParams.copilot?.executionStrategy === 'stop',
  })

  // 配置编辑始终以协调器中的最新草稿为基准，避免同一帧内连续更新互相覆盖。
  const updateCombatConfig = useCallback((update: (current: CombatConfigDraft) => CombatConfigDraft) => {
    updateConfig(update(configChannel.getState().draft ?? DEFAULT_COMBAT_CONFIG))
  }, [configChannel, updateConfig])

  const handleRetryConfigSave = async () => {
    if (isRetryingConfigSave) return
    const saved = await retryConfigSave()
    if (saved) setStatusMessage('自动战斗配置已同步', 'success')
  }

  const saveSelectedCopilotIndexes = useCallback((indexes: readonly number[], setId: string) => {
    const normalized = serializeCopilotSelection(indexes)
    updateCombatConfig(current => ({
      ...current,
      copilotSetSelections: {
        ...current.copilotSetSelections,
        [setId]: normalized,
      },
    }))
  }, [updateCombatConfig])

  const resetCopilotSetProgress = async () => {
    if (!preview?.copilots?.length) return false
    if (isResettingProgress) return false

    setIsResettingProgress(true)
    try {
      const result = await resetCopilotSetProgressRequest(preview.id)
      if (!result.success) {
        throw new Error(getErrorMessage(result))
      }
      const selected = syncQueueSet(
        preview.id,
        buildCopilotQueueEntries(preview),
        preview.copilots.map((_, index) => index),
        'reset',
      )
      saveSelectedCopilotIndexes(selected, preview.id)
      resetCopilotProgressView(preview.id)
      // 服务端进度已改变：下次预览必须重新读取计划，不能复用旧的 completedModes。
      void invalidateCopilotSetPlan(queryClient, preview.id)
      if (setRun) setDismissedRunId(setRun.runId)
      setStatusMessage('已重置作业集进度，将从第一关开始', 'success')
      return true
    } catch (error) {
      setStatusMessage(`重置失败: ${(error as Error).message}`, 'error')
      return false
    } finally {
      setIsResettingProgress(false)
    }
  }

  const activeSetPreview = preview?.type === 'set' ? preview : null
  const queueSetIndexes = new Set<number>()
  for (const entry of queue.entries) {
    if (
      activeSetPreview
      && entry.setId === activeSetPreview.id
      && entry.setItemIndex !== undefined
      && queue.selected.has(entry.id)
    ) {
      queueSetIndexes.add(entry.setItemIndex)
    }
  }

  const setView = deriveCopilotSetView({
    preview,
    selected: queueSetIndexes,
    setRun,
    dismissedRunId,
    raid: normalizeRaidValue(advancedParams.copilot?.raid),
    isWaitingForNext,
    isAutoStopping,
  })

  const executionProgress = useMemo(
    () => deriveExecutionProgress(trackedRun, setRun, queueRun),
    [trackedRun, setRun, queueRun],
  )

  const queueItemErrors = useMemo(() => {
    const run = setView.activeSetRun
    if (!run) return new Map<number, string>()
    return collectCopilotItemErrors(run.failures, run.summaryErrors ?? [])
  }, [setView.activeSetRun])

  // 终态后按服务端计划进度重建“待执行”选择。成功的条目会被计划标记为已完成，
  // 失败的条目保留待重试；同步失败只影响展示，不把 run 结果解释成完成。
  const activeSetRun = setView.activeSetRun
  useEffect(() => {
    if (!activeSetPreview || !activeSetRun || activeSetRun.isActive) return
    if (!isTerminalRunState(activeSetRun.state)) return
    const setId = activeSetRun.setId
    if (!setId) return
    if (reconciledRunRef.current === activeSetRun.runId) return
    reconciledRunRef.current = activeSetRun.runId

    const raid = normalizeRaidValue(activeSetRun.raid ?? advancedParams.copilot?.raid)
    void (async () => {
      const copilots = await refreshCopilotSet(setId, raid)
      if (!copilots?.length) return
      const currentRaid = normalizeRaidValue(configChannel.getState().draft?.advancedParams.copilot?.raid)
      const selected = syncQueueSet(
        setId,
        buildCopilotQueueEntries({ ...activeSetPreview, copilots }),
        pendingCopilotPlanIndexes(copilots, currentRaid),
        'refresh',
      )
      saveSelectedCopilotIndexes(selected, setId)
    })()
  }, [activeSetPreview, activeSetRun, advancedParams.copilot?.raid, configChannel, refreshCopilotSet, saveSelectedCopilotIndexes, syncQueueSet])

  const buildCommandArgs = (task: CombatTask): string[] => buildCombatCommandArgs(task.id, {
    input: taskInputs[task.id] || '',
    advanced: advancedParams[task.id],
    formationMode: normalizeFormationMode(autoFormation[task.id]),
    // 预览确认输入未带 s 前缀的作业集时，执行也补上服务端要求的 s 前缀。
    autoAddSetPrefix: task.id === 'copilot'
      && preview?.type === 'set'
      && preview.autoAddS === true,
  })

  const handleStartNextCopilot = async () => {
    if (!automationAvailable) {
      setStatusMessage(unavailableMessage, 'error')
      return
    }
    await continueSet()
  }

  const handleStopTask = async () => {
    await stop()
  }

  const executeCheckedQueue = async (entries: readonly CopilotQueueEntry[]) => {
    const setIndexes: number[] = []
    let setBacked = activeSetPreview !== null
    for (const entry of entries) {
      if (
        !activeSetPreview
        || entry.setId !== activeSetPreview.id
        || entry.setItemIndex === undefined
      ) {
        setBacked = false
        break
      }
      setIndexes.push(entry.setItemIndex)
    }
    const ordered = setBacked && setIndexes.every(
      (index, position) => position === 0 || index > setIndexes[position - 1]!,
    )

    setSubmittedEntryIds(new Set())
    if (activeSetPreview && setBacked && ordered) {
      await submitSet({
        setId: activeSetPreview.id,
        mode: toCopilotSetRunMode(copilotSetExecutionMode),
        raid: normalizeRaidValue(advancedParams.copilot?.raid),
        selectedIndexes: setIndexes,
        options: buildCopilotSetExecutionOptions(
          advancedParams.copilot,
          normalizeFormationMode(autoFormation.copilot),
        ),
        taskName: copilotTask.name,
      })
      return
    }

    await executeQueueRun(entries)
  }

  const handleExecute = async (task: CombatTask) => {
    if (!automationAvailable) {
      setStatusMessage(unavailableMessage, 'error')
      return
    }

    if (task.id === 'copilot' && queue.entries.length) {
      const queueEntries = checkedCopilotQueueEntries(queue.entries, queue.selected)
      if (!queueEntries.length) {
        setStatusMessage('请至少勾选一项队列作业', 'warning')
        return
      }
      if (isRunning || isSubmitting) {
        setStatusMessage('正在执行其他任务，请稍后再试', 'warning')
        return
      }
      await executeCheckedQueue(queueEntries)
      return
    }

    const inputValue = taskInputs[task.id] || ''
    const inputError = validateCombatInput(task.id, inputValue)
    if (inputError) {
      setStatusMessage(inputError)
      return
    }

    if (task.id === 'copilot' && !preview) {
      const firstArg = splitCopilotInputToArgs(inputValue)[0] || ''
      if (parseCopilotUri(firstArg)?.isSet) {
        await requestCopilotPreview(inputValue)
        setStatusMessage('已恢复作业集进度，请确认待执行关卡后再次执行')
        return
      }
    }

    if (task.id === 'copilot' && preview?.type === 'set' && preview.copilots?.length) {
      setStatusMessage('请至少勾选一项队列作业', 'warning')
      return
    }

    await submitTask({
      command: task.command,
      args: buildCommandArgs(task),
      taskName: task.name,
    })
  }

  const handleInputChange = (taskId: string, value: string) => {
    updateCombatConfig(current => ({
      ...current,
      taskInputs: { ...current.taskInputs, [taskId]: value },
    }))
    if (taskId === 'copilot') clearCopilotPreview()
  }

  const handleImportCopilotFile = async (file: File) => {
    if (importingCopilotFileRef.current) return
    if (queue.entries.length >= COPILOT_QUEUE_LIMIT) {
      setStatusMessage(COPILOT_QUEUE_FULL_MESSAGE, 'warning')
      return
    }
    importingCopilotFileRef.current = true
    setIsImportingCopilotFile(true)
    try {
      const result = await uploadCopilotFile(file)
      if (!result.success || !result.data?.path) {
        setStatusMessage(getErrorMessage(result), 'error')
        return
      }
      const content = await readCopilotFileText(file)
      const added = queue.add([buildCopilotQueueEntryFromFile(
        result.data.path,
        result.data.name || file.name,
        content,
        { stage: result.data.stage, stageId: result.data.stageId },
      )])
      if (!added) {
        setStatusMessage(COPILOT_QUEUE_FULL_MESSAGE, 'warning')
        return
      }
      clearCopilotPreview()
      setStatusMessage(`已导入本地作业: ${result.data.name || file.name}`, 'success')
    } catch (error) {
      setStatusMessage(getErrorMessage({ message: error instanceof Error ? error.message : undefined }), 'error')
    } finally {
      importingCopilotFileRef.current = false
      setIsImportingCopilotFile(false)
    }
  }

  const handleAdvancedChange = (taskId: string, key: string, value: string | number | boolean) => {
    updateCombatConfig(current => ({
      ...current,
      advancedParams: {
        ...current.advancedParams,
        [taskId]: {
          ...(current.advancedParams[taskId] || {}),
          [key]: value,
        },
      },
    }))
  }

  const handleFormationChange = (taskId: string, mode: FormationMode) => {
    updateCombatConfig(current => ({
      ...current,
      autoFormation: { ...current.autoFormation, [taskId]: mode },
    }))
  }

  const handleSetExecutionModeChange = (mode: CopilotSetExecutionMode) => {
    updateCombatConfig(current => ({
      ...current,
      copilotSetExecutionMode: mode,
    }))
  }

  const requestCopilotPreview = useCallback(async (
    rawValue?: string,
    openDetails = false,
    pendingTarget: CopilotDetailTarget | null = null,
  ) => {
    const requestId = ++pendingPreviewRequestRef.current
    const raid = normalizeRaidValue(advancedParams.copilot?.raid)
    if (openDetails) {
      setPendingPreviewTarget(pendingTarget)
      setCopilotDetail({ type: 'preview' })
    }
    setStatusMessage('正在获取作业信息...')
    try {
      const outcome = await loadCopilotPreview({
        input: rawValue ?? (taskInputs['copilot'] || ''),
        mode: panelStores.copilotPreviewMode.get(),
        raid,
      })
      if (outcome.status === 'cancelled') return outcome

      if (outcome.status === 'ready') {
        if (outcome.preview.type === 'set') {
          const setId = outcome.preview.id
          const indexes = restorableCopilotIndexes(outcome.preview.copilots ?? [], raid, copilotSetSelections[setId])
          const selected = syncQueueSet(setId, buildCopilotQueueEntries(outcome.preview), indexes)
          saveSelectedCopilotIndexes(selected, setId)
        }
        setStatusMessage(outcome.message)
        return outcome
      }

      if (outcome.status === 'failed') {
        setStatusMessage(
          outcome.kind === 'transport' || outcome.kind === 'unknown'
            ? `网络错误: ${outcome.message}`
            : outcome.message,
        )
        return outcome
      }

      setStatusMessage(outcome.message)
      return outcome
    } finally {
      if (pendingPreviewRequestRef.current === requestId) setPendingPreviewTarget(null)
    }
  }, [
    advancedParams.copilot?.raid,
    loadCopilotPreview,
    panelStores.copilotPreviewMode,
    copilotSetSelections,
    saveSelectedCopilotIndexes,
    setStatusMessage,
    syncQueueSet,
    taskInputs,
  ])

  const resolveQueuePreview = async (
    input: string,
    mode = panelStores.copilotPreviewMode.get(),
  ): Promise<{
    preview: CopilotSetInfo | null
    outcome: CopilotPreviewOutcome | null
  }> => {
    const target = resolveCopilotPreviewTarget(input, mode)
    if (!target) {
      return {
        preview: null,
        outcome: { status: 'invalid', message: INVALID_COPILOT_URI_MESSAGE },
      }
    }
    queueAddControllerRef.current?.abort()
    const controller = new AbortController()
    queueAddControllerRef.current = controller
    const outcome = await loadCopilotPreviewData(queryClient, {
      target,
      raid: normalizeRaidValue(advancedParams.copilot?.raid),
    }, {
      signal: controller.signal,
      force: false,
      track: () => {},
    })
    return {
      preview: outcome.status === 'ready' ? outcome.preview : null,
      outcome,
    }
  }

  const reportQueueAdd = (preview: CopilotSetInfo) => {
    if (preview.type === 'set') {
      const raid = normalizeRaidValue(advancedParams.copilot?.raid)
      const existingEntries = queue.entries.filter(entry => entry.setId === preview.id)
      const checkedIndexes = existingEntries.length
        ? existingEntries
          .filter(entry => entry.setItemIndex !== undefined && queue.selected.has(entry.id))
          .map(entry => entry.setItemIndex as number)
        : restorableCopilotIndexes(
          preview.copilots ?? [],
          raid,
          copilotSetSelections[preview.id],
        )
      syncQueueSet(preview.id, buildCopilotQueueEntries(preview), checkedIndexes)
      setStatusMessage(`已同步作业集 ${preview.copilots?.length ?? 0} 个作业到队列`, 'success')
      return
    }
    const wasFull = queue.entries.length >= COPILOT_QUEUE_LIMIT
    const added = queue.add(buildCopilotQueueEntries(preview))
    setStatusMessage(
      added
        ? `已加入 ${added} 个作业到队列`
        : wasFull
          ? COPILOT_QUEUE_FULL_MESSAGE
          : '这些作业已在队列中',
      added ? 'success' : 'warning',
    )
  }

  const reportQueueAddFailure = (outcome: CopilotPreviewOutcome) => {
    if (outcome.status === 'cancelled') return
    if (outcome.status === 'failed') {
      setStatusMessage(
        outcome.kind === 'transport' || outcome.kind === 'unknown'
          ? `网络错误: ${outcome.message}`
          : outcome.message,
        'error',
      )
      return
    }
    if (outcome.status === 'invalid' || outcome.status === 'empty') {
      setStatusMessage(outcome.message)
    }
  }

  const handleAddToQueue = async () => {
    if (isAddingToQueue) return
    const inputValue = taskInputs.copilot || ''
    if (!inputValue.trim()) {
      setStatusMessage('请输入作业链接')
      return
    }
    if (previewMatchesInput(preview, inputValue)) {
      reportQueueAdd(preview)
      return
    }

    setIsAddingToQueue(true)
    try {
      const outcome = await requestCopilotPreview(inputValue)
      if (outcome.status === 'ready') reportQueueAdd(outcome.preview)
    } finally {
      setIsAddingToQueue(false)
    }
  }

  const handleAddSearchUriToQueue = async (uri: string) => {
    if (isAddingToQueue) return

    setIsAddingToQueue(true)
    setAddingQueueUri(uri)
    setStatusMessage('正在获取作业信息...')
    try {
      const { preview: loaded, outcome } = await resolveQueuePreview(uri, 'auto')
      if (loaded) {
        reportQueueAdd(loaded)
        return
      }
      if (outcome) reportQueueAddFailure(outcome)
    } finally {
      setIsAddingToQueue(false)
      setAddingQueueUri(null)
    }
  }

  const executeQueueRun = async (
    entries: readonly CopilotQueueEntry[],
    retryModes?: ReadonlyMap<string, CopilotRaid | null>,
  ) => {
    const raid = normalizeRaidValue(advancedParams.copilot?.raid)
    const runEntries = toCopilotQueueRunEntries(entries, raid, retryModes)
    if (!runEntries.length || runEntries.length !== entries.length) {
      setStatusMessage('队列中存在无法解析的作业链接', 'error')
      return false
    }
    const submitted = await submitQueue({
      queueId: COPILOT_QUEUE_RUN_ID,
      name: COPILOT_QUEUE_RUN_NAME,
      mode: toCopilotSetRunMode(copilotSetExecutionMode),
      failurePolicy: toCopilotQueueFailurePolicy(advancedParams.copilot?.executionStrategy),
      entries: runEntries,
      options: buildCopilotSetExecutionOptions(
        advancedParams.copilot,
        normalizeFormationMode(autoFormation.copilot),
      ),
      taskName: copilotTask.name,
    })
    if (submitted) setSubmittedEntryIds(new Set(entries.map(entry => entry.id)))
    return submitted
  }

  const selectQueueEntries = (ids: readonly string[]) => {
    const target = new Set(ids)
    for (const entry of queue.entries) {
      if (target.has(entry.id) !== queue.selected.has(entry.id)) queue.toggle(entry.id)
    }
  }

  const handleContinueQueue = async () => {
    if (!automationAvailable) {
      setStatusMessage(unavailableMessage, 'error')
      return
    }
    await continueQueue()
  }

  const handleSkipQueueEntry = async () => {
    if (!automationAvailable) {
      setStatusMessage(unavailableMessage, 'error')
      return
    }
    await skipQueueEntry()
  }

  const handleRetryFailedQueue = async () => {
    const retryModes = getCopilotQueueRetryModes(queueRun)
    const entriesById = new Map(queue.entries.map(entry => [entry.id, entry]))
    const failedEntries = [...retryModes.keys()].flatMap(id => entriesById.get(id) ?? [])
    if (!failedEntries.length) {
      setStatusMessage('没有可重试的失败项', 'warning')
      return
    }
    if (!automationAvailable) {
      setStatusMessage(unavailableMessage, 'error')
      return
    }
    if (isRunning || isSubmitting) {
      setStatusMessage('正在执行其他任务，请稍后再试', 'warning')
      return
    }
    selectQueueEntries(failedEntries.map(entry => entry.id))
    setSubmittedEntryIds(new Set())
    await executeQueueRun(failedEntries, retryModes)
  }

  const previewCopilotUri = async (uri: string) => {
    const normalizedUri = normalizeCopilotInput(uri).trim()
    const entry = copilotSearchResult?.copilots.find(item => item.uri === normalizedUri)
    clearCopilotPreview()
    await requestCopilotPreview(
      normalizedUri,
      true,
      entry ? buildCopilotDiscoveryDetailTarget(entry) : null,
    )
  }

  const handleSearchParadox = async (operatorName: string) => {
    if (isSearchingParadox) return
    if (!operatorName.trim()) {
      setStatusMessage('请输入干员名字')
      return
    }

    setStatusMessage('正在搜索作业...')
    const outcome = await searchParadoxJobs(operatorName)
    if (outcome.status === 'cancelled') return

    if (outcome.status === 'failed') {
      setStatusMessage(
        outcome.kind === 'transport' || outcome.kind === 'unknown'
          ? `搜索失败: ${outcome.message}`
          : outcome.message,
      )
      return
    }

    const { result } = outcome
    if (!result.copilots.length) {
      setStatusMessage('未找到作业')
      return
    }

    setStatusMessage(`找到 ${result.copilots.length} 个作业`)
    const recommendedUri = result.recommended?.uri
    if (recommendedUri) {
      updateCombatConfig(current => ({
        ...current,
        taskInputs: { ...current.taskInputs, paradoxcopilot: recommendedUri },
      }))
    }
  }

  const handleCopilotSearch = async (request: CopilotSearchRequest) => {
    const outcome = await searchCopilotJobs(request)
    if (outcome.status === 'cancelled') return
    if (outcome.status === 'failed') {
      setStatusMessage(
        outcome.kind === 'transport' || outcome.kind === 'unknown'
          ? `搜索失败: ${outcome.message}`
          : outcome.message,
      )
    }
  }

  const handleOpenDiscovery = () => {
    panelStores.copilotSearchKeyword.set('')
    panelStores.copilotSearchLevel.set('')
    panelStores.copilotSearchOrder.set('hot')
    setIsDiscoveryOpen(true)
    refreshCopilotSearchDefault(buildCopilotSearchRequest())
  }

  const handleCloseDiscovery = () => {
    setIsDiscoveryOpen(false)
    cancelCopilotSearch()
    resetCopilotSearch()
  }

  const applyParadoxUri = (uri: string) => {
    updateCombatConfig(current => ({
      ...current,
      taskInputs: { ...current.taskInputs, paradoxcopilot: uri },
    }))
  }

  const copilotTask = getCombatTask('copilot')
  const specialTask = activeCombatMode === 'copilot' ? null : getCombatTask(activeCombatMode)

  const copilotConfig: CombatCopilotConfig = {
    input: taskInputs.copilot || '',
    advanced: advancedParams.copilot ?? {},
    formationMode: normalizeFormationMode(autoFormation.copilot),
    raid: normalizeRaidValue(advancedParams.copilot?.raid),
    setExecutionMode: copilotSetExecutionMode,
    onInputChange: value => handleInputChange('copilot', value),
    onAdvancedChange: (key, value) => handleAdvancedChange('copilot', key, value),
    onFormationChange: mode => handleFormationChange('copilot', mode),
    onSetExecutionModeChange: handleSetExecutionModeChange,
  }

  const copilotSelection: CombatCopilotSelectionProjection = {
    isResetting: isResettingProgress,
    onOpenReset: () => setResetProgressDialogOpen(true),
  }

  const copilotFileImport: CombatCopilotFileImportProjection = {
    isImporting: isImportingCopilotFile,
    onImport: file => void handleImportCopilotFile(file),
  }

  const copilotSearch: CombatCopilotSearchProjection = {
    isOpen: isDiscoveryOpen,
    onOpen: handleOpenDiscovery,
    onClose: handleCloseDiscovery,
    keywordStore: panelStores.copilotSearchKeyword,
    levelStore: panelStores.copilotSearchLevel,
    operatorStore: panelStores.copilotSearchOperators,
    operatorFilterEnabledStore: panelStores.copilotSearchOperatorsEnabled,
    operatorFilterRememberStore: panelStores.copilotSearchOperatorsRemember,
    orderStore: panelStores.copilotSearchOrder,
    matchStore: panelStores.copilotSearchMatch,
    viewStore: panelStores.copilotSearchView,
    stages,
    stagesLoading: stagesQuery.isPending,
    stagesError,
    operators: operatorOptions,
    operatorsLoading: operBoxQuery.isPending,
    operatorsError,
    ownedOperatorNames,
    result: copilotSearchResult,
    searching: isSearchingCopilot,
    refreshing: isRefreshingCopilot,
    addingUri: addingQueueUri,
    onSearch: request => void handleCopilotSearch(request),
    onLoadMore: loadCopilotSearchPage,
    onCancel: cancelCopilotSearch,
    onPreviewUri: uri => void previewCopilotUri(uri),
    onAddToQueue: uri => void handleAddSearchUriToQueue(uri),
    onRetryData: () => {
      void stagesQuery.refetch()
      void operBoxQuery.refetch()
    },
  }

  const copilotQueue: CombatCopilotQueueProjection = {
    entries: queue.entries,
    selected: queue.selected,
    setId: activeSetPreview?.id ?? null,
    itemStatuses: setView.itemStatuses,
    itemErrors: queueItemErrors,
    submittedEntryIds,
    queueRun,
    failurePolicy: toCopilotQueueFailurePolicy(advancedParams.copilot?.executionStrategy),
    isRunning,
    isSubmitting,
    isContinuing,
    isSkipping,
    isAdding: isAddingToQueue,
    addingUri: addingQueueUri,
    automationAvailable,
    unavailableMessage,
    onToggle: queue.toggle,
    onRemove: queue.remove,
    onMove: queue.move,
    onClear: queue.clear,
    onAddCurrent: () => void handleAddToQueue(),
    onAddUri: uri => void handleAddSearchUriToQueue(uri),
    onContinueQueue: () => void handleContinueQueue(),
    onSkipEntry: () => void handleSkipQueueEntry(),
    onRetryFailed: () => void handleRetryFailedQueue(),
  }

  const paradoxSearch: CombatParadoxSearchProjection = {
    nameStore: panelStores.paradoxSearchName,
    result: paradoxSearchResult,
    searching: isSearchingParadox,
    onSearch: name => void handleSearchParadox(name),
    onCancel: cancelParadoxSearch,
    onSelectUri: applyParadoxUri,
  }

  const baseExecution: CombatExecutionActions = {
    automationAvailable,
    unavailableMessage,
    isRunning,
    isStopping,
    isSubmitting,
    isContinuing,
    onExecute: () => void handleExecute(copilotTask),
    onStop: () => void handleStopTask(),
  }

  const copilotExecution: CombatCopilotExecutionActions = {
    ...baseExecution,
    isWaitingForNext: setView.waitingEntry !== null,
    onStartNext: () => void handleStartNextCopilot(),
  }

  return (
    <>
      {configSyncError && (
        <div
          role="alert"
          className="status-warning flex min-h-11 flex-wrap items-center justify-between gap-3.5 rounded-lg px-3 py-2 text-sm leading-5"
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

      <div className="combat-workspace-grid">
        <div className="combat-main-column">
          <CombatModeTabs
            activeMode={activeCombatMode}
            onSelect={mode => {
              setActiveCombatMode(mode)
              if (mode !== 'copilot') {
                setCopilotDetail(null)
                handleCloseDiscovery()
              }
            }}
          />

          <CombatExecutionProgressPanel progress={executionProgress} />

          <div className="app-stack-section">
            {activeCombatMode === 'copilot' && (
              <CombatCopilotTaskPanel
                task={copilotTask}
                config={copilotConfig}
                preview={{
                  info: preview,
                  loading: isLoadingSet,
                  pendingTarget: pendingPreviewTarget,
                  modeStore: panelStores.copilotPreviewMode,
                  onPreview: () => void requestCopilotPreview(undefined, true),
                  onCancel: cancelCopilotPreview,
                }}
                fileImport={copilotFileImport}
                view={setView}
                selection={copilotSelection}
                queue={copilotQueue}
                search={copilotSearch}
                execution={copilotExecution}
                detail={copilotDetail}
                onOpenQueueDetail={id => setCopilotDetail({ type: 'queue', id })}
                onCloseDetail={() => setCopilotDetail(null)}
              />
            )}

            {specialTask && (
              <CombatSpecialTaskPanel
                task={specialTask}
                input={taskInputs[specialTask.id] || ''}
                advanced={advancedParams[specialTask.id] ?? {}}
                onInputChange={value => handleInputChange(specialTask.id, value)}
                onAdvancedChange={(key, value) => handleAdvancedChange(specialTask.id, key, value)}
                paradoxSearch={specialTask.id === 'paradoxcopilot' ? paradoxSearch : undefined}
                execution={{
                  ...baseExecution,
                  onExecute: () => void handleExecute(specialTask),
                }}
              />
            )}
          </div>
        </div>

        <aside className="combat-monitor-column" aria-label="设备画面">
          <DeviceMonitorPanel
            className="combat-monitor-panel"
            surfaceClassName="combat-monitor-surface"
          />
        </aside>
      </div>

      <ConfirmDialog
        isOpen={resetProgressDialogOpen}
        onClose={() => setResetProgressDialogOpen(false)}
        onConfirm={resetCopilotSetProgress}
        title="重置作业集进度？"
        message="已记录的通关进度会被清除，下次将从第一关重新开始。"
        confirmText="确认重置"
        variant="danger"
      />
    </>
  )
}
