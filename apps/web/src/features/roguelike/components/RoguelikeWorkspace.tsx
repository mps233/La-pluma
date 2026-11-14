import { useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { useAutomationAvailability, useStatusStore } from '@/features/runtime-status'
import { DeviceMonitorPanel } from '@/features/device-mirror'
import { useUserConfig } from '@/features/user-config'
import { roguelikeConfigAdapter } from '../model/roguelikeConfig'
import {
  DEFAULT_ROGUELIKE_MODE,
  ROGUELIKE_TASKS,
  normalizeRoguelikeModeForTheme,
} from '../model/roguelikeTasks'
import { buildRoguelikeExecutionPlan } from '../model/roguelikeExecution'
import { validateRoguelikeTaskInput } from '../model/roguelikeValidation'
import { useRoguelikeExecution } from '../hooks/useRoguelikeExecution'
import RoguelikeModePanel from './RoguelikeModePanel'
import RoguelikeResultPanel from './RoguelikeResultPanel'
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

export default function RoguelikeWorkspace() {
  const setStatusMessage = useStatusStore(state => state.setMessage)
  const { isAvailable: automationAvailable, unavailableMessage } = useAutomationAvailability()
  const {
    isRunning,
    isStopping,
    isWaitingForCombat,
    pendingStopMode,
    isSubmitting,
    trackedRun,
    execute,
    stop,
  } = useRoguelikeExecution({ notify: setStatusMessage })
  const {
    draft: configDraft,
    syncState: configSyncState,
    error: configSyncError,
    update: updateConfig,
    retry: retryConfigSave,
  } = useUserConfig(roguelikeConfigAdapter)
  const taskInputs = configDraft?.taskInputs ?? EMPTY_TASK_INPUTS
  const advancedParams = configDraft?.advancedParams ?? EMPTY_ADVANCED_PARAMS
  const isRetryingConfigSave = configSyncState === 'saving'
  const [activeMode, setActiveMode] = useState<RoguelikeMode>(DEFAULT_ROGUELIKE_MODE)

  const activeTask = ROGUELIKE_TASKS.find(task => task.id === activeMode) ?? ROGUELIKE_TASKS[0]
  if (!activeTask) return null

  const activeAdvanced = advancedParams[activeTask.id] ?? EMPTY_ADVANCED_VALUES
  const activeTheme = taskInputs[activeTask.id] || ''

  const handleRetryConfigSave = async () => {
    if (isRetryingConfigSave) return
    const saved = await retryConfigSave()
    if (saved) setStatusMessage('肉鸽配置已同步', 'success')
  }

  const handleThemeChange = (value: string) => {
    updateConfig({
      taskInputs: { ...taskInputs, [activeTask.id]: value },
      advancedParams: normalizeRoguelikeModeForTheme(activeTask.id, value, advancedParams),
    })
  }

  const handleAdvancedChange = (key: string, value: string | number | boolean) => {
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
    if (!automationAvailable) {
      setStatusMessage(unavailableMessage, 'error')
      return
    }

    const inputError = validateRoguelikeTaskInput(activeTask.id, taskInputs, advancedParams)
    if (inputError) {
      setStatusMessage(inputError)
      return
    }

    const plan = buildRoguelikeExecutionPlan(activeTask.id, taskInputs, advancedParams)
    await execute({
      command: plan.command,
      params: plan.params,
      taskConfig: plan.taskConfig,
      taskName: activeTask.name,
    })
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
            onClick={() => void handleRetryConfigSave()}
            disabled={isRetryingConfigSave}
            aria-busy={isRetryingConfigSave || undefined}
            className="min-h-11 shrink-0"
          >
            {isRetryingConfigSave
              ? <><LoaderCircle className="animate-spin" aria-hidden="true" />同步中</>
              : '重新同步'}
          </Button>
        </div>
      )}

      <div className="roguelike-workspace-grid">
        <RoguelikeModePanel activeMode={activeMode} onModeChange={setActiveMode} />

        <div className="roguelike-main-column">
          <RoguelikeThemePanel
            task={activeTask}
            theme={activeTheme}
            onThemeChange={handleThemeChange}
          />

          <RoguelikeResultPanel run={trackedRun} command={activeTask.command} />
        </div>

        <RoguelikeSettingsPanel
          task={activeTask}
          theme={activeTheme}
          advanced={activeAdvanced}
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

        <aside className="roguelike-monitor-column" aria-label="设备画面">
          <DeviceMonitorPanel
            className="roguelike-monitor-panel"
            surfaceClassName="roguelike-monitor-surface"
          />
        </aside>
      </div>
    </>
  )
}
