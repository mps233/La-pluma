import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ConfigFieldCheckbox, ConfigFieldInput } from './ConfigFieldControls'
import SwitchSettingRow from './SwitchSettingRow'
import { notify } from '@/shared/notifications'
import { useSettingsAutoUpdate } from '../hooks/useSettingsAutoUpdate'
import type { AutoUpdateConfig } from '../types'

export default function AutoUpdateConfigPanel() {
  const shouldReduceMotion = useReducedMotion()
  const {
    draft: autoUpdate,
    update: updateAutoUpdate,
    flush,
  } = useSettingsAutoUpdate(notify)

  const applyUpdate = (patch: Partial<AutoUpdateConfig>) => {
    updateAutoUpdate(patch)
    flush()
  }

  return (
    <section className="min-w-0" onBlur={flush}>
      <SwitchSettingRow
        id="auto-update-enabled"
        label="自动更新"
        checked={autoUpdate.enabled}
        onCheckedChange={checked => applyUpdate({ enabled: checked })}
      />

      <AnimatePresence initial={false}>
        {autoUpdate.enabled && (
          <motion.div
            initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: shouldReduceMotion ? 0.12 : 0.2 }}
          >
            <div className="mt-3.5 flex flex-col gap-3.5">
              <ConfigFieldInput
                id="auto-update-time"
                type="text"
                label="更新时间"
                value={autoUpdate.time}
                onChange={event => updateAutoUpdate({ time: event.target.value })}
                placeholder="HH:MM"
              />
              <ConfigFieldCheckbox
                id="auto-update-core"
                checked={autoUpdate.updateCore}
                onCheckedChange={(checked: boolean) => applyUpdate({ updateCore: checked })}
                label="更新 MaaCore"
              />
              <ConfigFieldCheckbox
                id="auto-update-cli"
                checked={autoUpdate.updateCli}
                onCheckedChange={(checked: boolean) => applyUpdate({ updateCli: checked })}
                label="更新 MAA CLI"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
