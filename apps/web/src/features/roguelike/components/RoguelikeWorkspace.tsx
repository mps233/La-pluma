import { useEffect, useRef, useState } from 'react'
import { SegmentedTabs, SegmentedTabPanel } from '@/shared/components'
import { dismissNotice, notify } from '@/shared/notifications'
import { useAutomationAvailability } from '@/features/runtime-status'
import { DeviceMonitorLayout } from '@/features/device-mirror'
import { useUserConfig } from '@/features/user-config'
import { roguelikeConfigAdapter } from '../model/roguelikeConfig'
import {
  DEFAULT_ROGUELIKE_MODE,
  ROGUELIKE_TASKS,
  normalizeRoguelikeModeForKnownTheme,
} from '../model/roguelikeTasks'
import { buildRoguelikeExecutionPlan } from '../model/roguelikeExecution'
import {
  validateRoguelikeTaskInputError,
  type RoguelikeFieldError,
} from '../model/roguelikeValidation'
import { useRoguelikeExecution } from '../hooks/useRoguelikeExecution'
import RoguelikeModePanel from './RoguelikeModePanel'
import RoguelikeProgressPanel from './RoguelikeProgressPanel'
import RoguelikeSettingsPanel from './RoguelikeSettingsPanel'
import RoguelikeThemePanel from './RoguelikeThemePanel'
import type {
  RoguelikeAdvancedParams,
  RoguelikeAdvancedValues,
  RoguelikeMode,
  RoguelikeTaskInputs,
} from '../types'

const EMPTY_TASK_INPUTS: RoguelikeTaskInputs = {}
const EMPTY_ADVANCED_PARAMS: RoguelikeAdvancedParams = {}
const EMPTY_ADVANCED_VALUES: RoguelikeAdvancedValues = {}
const ROGUELIKE_CONFIG_NOTICE_ID = 'roguelike-config-save'

export default function RoguelikeWorkspace() {
  const { isAvailable: automationAvailable, unavailableMessage } = useAutomationAvailability()
  const {
    isRunning,
    isStopping,
    isWaitingForCombat,
    pendingStopMode,
    isSubmitting,
    trackedRun,
    trackedRunLabel,
    lastRun,
    hasSnapshot,
    resolvingIdentity,
    trackedCommand,
    execute,
    stop,
  } = useRoguelikeExecution({ notify })
  const {
    draft: configDraft,
    syncState: configSyncState,
    error: configSyncError,
    loadState: configLoadState,
    loadError: configLoadError,
    update: updateConfig,
    retry: retryConfigSave,
    reload: reloadConfig,
  } = useUserConfig(roguelikeConfigAdapter)
  const taskInputs = configDraft?.taskInputs ?? EMPTY_TASK_INPUTS
  const advancedParams = configDraft?.advancedParams ?? EMPTY_ADVANCED_PARAMS
  const isRetryingConfigSave = configSyncState === 'saving'
  const configReady = configLoadState === 'ready'
  const [activeMode, setActiveMode] = useState<RoguelikeMode>(DEFAULT_ROGUELIKE_MODE)
  const [fieldError, setFieldError] = useState<RoguelikeFieldError | null>(null)
  const isLocked = isRunning || isSubmitting
  const editable = configReady && !isLocked

  const activeTask = ROGUELIKE_TASKS.find(task => task.id === activeMode) ?? ROGUELIKE_TASKS[0]

  const handleRetryConfigSave = async () => {
    if (isRetryingConfigSave) return
    const saved = await retryConfigSave()
    if (saved) notify('肉鸽配置已同步', 'success')
  }
  const retryConfigSaveRef = useRef(handleRetryConfigSave)

  useEffect(() => {
    retryConfigSaveRef.current = handleRetryConfigSave
  })

  useEffect(() => {
    if (!configSyncError) {
      dismissNotice(ROGUELIKE_CONFIG_NOTICE_ID)
      return
    }
    notify(configSyncError, 'error', {
      id: ROGUELIKE_CONFIG_NOTICE_ID,
      action: {
        label: '重新同步',
        onClick: () => {
          void retryConfigSaveRef.current()
        },
      },
    })
  }, [configSyncError])

  useEffect(() => {
    if (!fieldError) return
    const fieldId = fieldError.key === 'theme'
      ? `roguelike-${activeTask?.id}-theme`
      : `roguelike-${activeTask?.id}-${fieldError.key}`
    document.getElementById(fieldId)?.focus()
  }, [activeTask?.id, fieldError])

  useEffect(() => {
    if (!trackedCommand || trackedCommand === activeMode) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 运行锁定期间仅对齐模式，不会与用户操作冲突
    setActiveMode(trackedCommand)
  }, [activeMode, trackedCommand])

  if (!activeTask) return null

  const activeAdvanced = advancedParams[activeTask.id] ?? EMPTY_ADVANCED_VALUES
  const activeTheme = taskInputs[activeTask.id] || ''

  const handleThemeChange = (value: string) => {
    if (!editable) return
    setFieldError(previous => previous?.key === 'theme' ? null : previous)
    updateConfig({
      taskInputs: { ...taskInputs, [activeTask.id]: value },
      advancedParams: normalizeRoguelikeModeForKnownTheme(activeTask.id, value, advancedParams),
    })
  }

  const handleAdvancedChange = (key: string, value: string | number | boolean) => {
    if (!editable) return
    setFieldError(previous => previous?.key === key ? null : previous)
    updateConfig({
      taskInputs,
      advancedParams: {
        ...advancedParams,
        [activeTask.id]: {
          ...activeAdvanced,
          [key]: value,
        },
      },
    })
  }

  const handleExecute = async () => {
    if (!editable) return
    if (!automationAvailable) {
      notify(unavailableMessage, 'error')
      return
    }

    const normalizedAdvanced = normalizeRoguelikeModeForKnownTheme(
      activeTask.id,
      activeTheme,
      advancedParams,
    )
    const inputError = validateRoguelikeTaskInputError(activeTask.id, taskInputs, normalizedAdvanced)
    if (inputError) {
      setFieldError(inputError)
      return
    }
    setFieldError(null)

    if (normalizedAdvanced !== advancedParams) {
      updateConfig({ taskInputs, advancedParams: normalizedAdvanced })
    }

    const plan = buildRoguelikeExecutionPlan(activeTask.id, taskInputs, normalizedAdvanced)
    await execute({
      command: plan.command,
      params: plan.params,
      taskConfig: plan.taskConfig,
      taskName: activeTask.name,
    })
  }

  return (
    <>
      <SegmentedTabs
        value={activeMode}
        onValueChange={(next) => {
          if (!editable) return
          setFieldError(null)
          setActiveMode(next)
        }}
      >
        <DeviceMonitorLayout
          variant="mode"
          mode={(
            <RoguelikeModePanel
              activeMode={activeMode}
              disabled={!editable}
            />
          )}
          content={(
            <SegmentedTabPanel value={activeMode} id="roguelike-mode-panel" className="contents">
              <div className="roguelike-main-column" data-monitor-area="main">
                <RoguelikeThemePanel
                  task={activeTask}
                  theme={activeTheme}
                  disabled={!editable}
                  error={fieldError?.key === 'theme' ? fieldError.message : undefined}
                  onThemeChange={handleThemeChange}
                />

                <RoguelikeProgressPanel
                  key={activeMode}
                  mode={activeMode}
                  run={trackedRun}
                  lastRun={lastRun}
                  hasSnapshot={hasSnapshot}
                  resolvingIdentity={resolvingIdentity}
                  taskName={trackedRunLabel}
                />
              </div>

              <RoguelikeSettingsPanel
                task={activeTask}
                theme={activeTheme}
                advanced={activeAdvanced}
                editable={editable}
                fieldError={fieldError}
                configReady={configReady}
                configLoadState={configLoadState}
                configLoadError={configLoadError}
                onReloadConfig={() => void reloadConfig({ force: true })}
                onAdvancedChange={handleAdvancedChange}
                execution={{
                  isRunning,
                  isStopping,
                  isWaitingForCombat,
                  pendingStopMode,
                  isSubmitting,
                  automationAvailable,
                  unavailableMessage,
                  onExecute: () => void handleExecute(),
                  onStop: mode => void stop(mode),
                }}
              />
            </SegmentedTabPanel>
          )}
        />
      </SegmentedTabs>
    </>
  )
}
