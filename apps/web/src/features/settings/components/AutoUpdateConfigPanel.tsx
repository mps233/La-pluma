import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Clock3, LoaderCircle, Save } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Switch } from '@/shared/ui/switch'
import { ConfigFieldCheckbox, ConfigFieldInput } from './ConfigFieldControls'
import { useStatusStore } from '@/features/runtime-status'
import { useSettingsAutoUpdate } from '../hooks/useSettingsAutoUpdate'

export default function AutoUpdateConfigPanel() {
  const setStatusMessage = useStatusStore(state => state.setMessage)
  const shouldReduceMotion = useReducedMotion()
  const {
    draft: autoUpdate,
    dirty: autoUpdateDirty,
    saving: autoUpdateSaving,
    feedback: autoUpdateFeedback,
    update: updateAutoUpdate,
    save: saveAutoUpdateConfig,
  } = useSettingsAutoUpdate(setStatusMessage)

  const handleSaveAutoUpdate = () => {
    void saveAutoUpdateConfig()
  }

  return (
    <section className="surface-soft rounded-xl p-4">
      <div className="flex items-center justify-between gap-3.5">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="icon-well flex h-9 w-9 shrink-0 items-center justify-center rounded-lg brand-text">
            <Clock3 size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">自动更新</h3>
            <p className="mt-1 text-xs leading-5 text-tertiary">每天按设定时间更新所选组件</p>
          </div>
        </div>
        <Switch
          checked={autoUpdate.enabled}
          onCheckedChange={checked => updateAutoUpdate({ enabled: checked })}
          aria-label="启用自动更新"
        />
      </div>

      <AnimatePresence initial={false}>
        {autoUpdate.enabled && (
          <motion.div
            initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: shouldReduceMotion ? 0.12 : 0.2 }}
            className="mt-4 grid gap-3.5 border-t border-border pt-4 md:grid-cols-[12rem_minmax(0,1fr)] md:items-end xl:grid-cols-1 xl:items-stretch"
          >
            <ConfigFieldInput
              id="auto-update-time"
              type="text"
              label="更新时间"
              value={autoUpdate.time}
              onChange={event => updateAutoUpdate({ time: event.target.value })}
              placeholder="HH:MM"
              className="max-w-48"
            />
            <div className="flex min-h-11 flex-wrap items-center gap-x-4.5 gap-y-2">
              <ConfigFieldCheckbox
                checked={autoUpdate.updateCore}
                onCheckedChange={(checked: boolean) => updateAutoUpdate({ updateCore: checked })}
                label="更新 MaaCore"
              />
              <ConfigFieldCheckbox
                checked={autoUpdate.updateCli}
                onCheckedChange={(checked: boolean) => updateAutoUpdate({ updateCli: checked })}
                label="更新 MAA CLI"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {autoUpdateFeedback && (
        <div
          className={`mt-4 rounded-lg px-3 py-2.5 text-xs leading-5 ${
            autoUpdateFeedback.type === 'success'
              ? 'status-success'
              : autoUpdateFeedback.type === 'warning'
                ? 'status-warning'
                : 'status-danger'
          }`}
          role={autoUpdateFeedback.type === 'error' ? 'alert' : 'status'}
        >
          {autoUpdateFeedback.message}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3.5 border-t border-border pt-4">
        <p className="text-xs text-tertiary">{autoUpdateDirty ? '有尚未保存的更改' : '设置会在保存后生效'}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!autoUpdateDirty || autoUpdateSaving}
          aria-busy={autoUpdateSaving || undefined}
          onClick={handleSaveAutoUpdate}
        >
          {autoUpdateSaving
            ? <><LoaderCircle className="animate-spin" aria-hidden="true" />保存中</>
            : (
              <>
                <Save size={16} aria-hidden="true" />
                保存自动更新
              </>
            )}
        </Button>
      </div>
    </section>
  )
}
