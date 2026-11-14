import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Clock3, Plus, X } from 'lucide-react'
import { IconButton, SmoothPanel, Switch } from '@/shared/components'
import {
  MAX_SCHEDULE_ENTRIES,
  appendScheduleEntry,
  removeScheduleEntry,
  setScheduleEntryEnabled,
  setScheduleTimeEntry,
  type ScheduleTimeEntry,
} from '../model/automationSchedule'

interface ScheduleTimeFieldProps {
  index: number
  time: string
  disabled: boolean
  onCommit: (time: string) => boolean
}

const scheduleTimeDigits = (value: string) => value.replace(/\D/g, '').slice(0, 4)

const maskScheduleTime = (digits: string) => (
  digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`
)

const normalizeScheduleTimeDraft = (draft: string) => {
  const digits = scheduleTimeDigits(draft)
  if (digits.length === 0) return null
  if (digits.length <= 2) return `${digits.padStart(2, '0')}:00`
  const padded = digits.padStart(4, '0')
  return `${padded.slice(0, 2)}:${padded.slice(2)}`
}

function ScheduleTimeField({ index, time, disabled, onCommit }: ScheduleTimeFieldProps) {
  const [draft, setDraft] = useState(time)

  useEffect(() => {
    setDraft(time)
  }, [time])

  const commit = (candidate: string) => {
    if (candidate === time) {
      setDraft(time)
      return
    }

    if (!onCommit(candidate)) setDraft(time)
  }

  const handleChange = (value: string) => {
    const digits = scheduleTimeDigits(value)
    setDraft(maskScheduleTime(digits))
    if (digits.length === 4) commit(`${digits.slice(0, 2)}:${digits.slice(2)}`)
  }

  const handleBlur = () => {
    const candidate = normalizeScheduleTimeDraft(draft)
    if (!candidate) {
      setDraft(time)
      return
    }

    commit(candidate)
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={5}
      placeholder="HH:MM"
      id={`automation-schedule-time-${index}`}
      value={draft}
      disabled={disabled}
      aria-label={`第 ${index + 1} 个执行时间`}
      className="automation-time-input"
      onChange={(event) => handleChange(event.target.value)}
      onBlur={handleBlur}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
    />
  )
}

export interface AutomationScheduleChange {
  enabled?: boolean
  entries?: ScheduleTimeEntry[]
}

interface AutomationScheduleCardProps {
  enabled: boolean
  entries: ScheduleTimeEntry[]
  disabled: boolean
  onChange: (next: AutomationScheduleChange) => void
  onError: (message: string) => void
}

export default function AutomationScheduleCard({
  enabled,
  entries,
  disabled,
  onChange,
  onError,
}: AutomationScheduleCardProps) {
  const shouldReduceMotion = useReducedMotion()
  const enabledCount = entries.filter(entry => entry.enabled).length
  const pausedTimes = entries.map(entry => entry.time).join(' / ')

  const handleEnabledChange = (nextEnabled: boolean) => {
    onChange({ enabled: nextEnabled })
  }

  const addScheduleTime = () => {
    const nextEntries = appendScheduleEntry(entries)
    if (!nextEntries) {
      onError('没有可添加的执行时间')
      return
    }

    onChange({ entries: nextEntries })
  }

  const removeScheduleTime = (index: number) => {
    onChange({ entries: removeScheduleEntry(entries, index) })
  }

  const updateScheduleTime = (index: number, time: string) => {
    const updated = setScheduleTimeEntry(entries, index, time)
    if (!updated.ok) {
      if (updated.reason === 'duplicate') onError('该执行时间已经存在')
      if (updated.reason === 'invalid') onError('请输入 00:00–23:59 的时间')
      return false
    }

    onChange({ entries: updated.entries })
    return true
  }

  const updateScheduleTimeEnabled = (index: number, nextEnabled: boolean) => {
    onChange({ entries: setScheduleEntryEnabled(entries, index, nextEnabled) })
  }

  return (
    <SmoothPanel className="automation-side-card">
      <div className="automation-side-card-heading">
        <div className="automation-side-card-heading-text">
          <h3><Clock3 size={16} strokeWidth={1.8} aria-hidden="true" /><span>定时执行</span></h3>
          <p>到点自动运行任务流程</p>
        </div>
        <div className="automation-side-card-heading-actions">
          <span className="automation-schedule-count" aria-label={`已设置 ${entries.length} 个执行时间`}>
            {entries.length === 0 ? '0' : `${enabledCount}/${entries.length}`}
          </span>
          <Switch
            checked={enabled}
            onChange={handleEnabledChange}
            disabled={disabled}
            label="启用定时执行"
            className="automation-card-switch"
          />
        </div>
      </div>

      {enabled ? (
        <motion.div
          className="automation-schedule-body"
          initial={shouldReduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
        >
          {entries.length === 0 ? (
            <p className="automation-schedule-empty">还没有执行时间</p>
          ) : (
            <div className="automation-schedule-times">
              {entries.map((entry, index) => (
                <div
                  key={`schedule-time-${index}`}
                  className={`automation-schedule-time-row${entry.enabled ? '' : ' is-off'}`}
                >
                  <ScheduleTimeField
                    index={index}
                    time={entry.time}
                    disabled={disabled}
                    onCommit={(time) => updateScheduleTime(index, time)}
                  />
                  <Switch
                    checked={entry.enabled}
                    onChange={(nextEnabled) => updateScheduleTimeEnabled(index, nextEnabled)}
                    disabled={disabled}
                    label={`${entry.time} 启用`}
                    compact
                    className="automation-schedule-row-switch"
                  />
                  {entries.length > 1 ? (
                    <IconButton
                      icon={<X size={16} strokeWidth={2.2} aria-hidden="true" />}
                      variant="ghost"
                      size="md"
                      onClick={() => removeScheduleTime(index)}
                      disabled={disabled}
                      className="automation-schedule-row-remove"
                      aria-label={`删除 ${entry.time}`}
                      title="删除时间"
                    />
                  ) : <span className="automation-schedule-row-remove-placeholder" aria-hidden="true" />}
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            className="automation-schedule-add"
            onClick={addScheduleTime}
            disabled={disabled || entries.length >= MAX_SCHEDULE_ENTRIES}
          >
            <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
            <span>新增时间</span>
            {entries.length >= MAX_SCHEDULE_ENTRIES && <small>最多 {MAX_SCHEDULE_ENTRIES} 个</small>}
          </button>
        </motion.div>
      ) : (
        <div className="automation-schedule-paused">
          <span className="automation-schedule-paused-label">已暂停</span>
          <span className="automation-schedule-paused-times">
            {entries.length === 0 ? '未设置执行时间' : pausedTimes}
          </span>
        </div>
      )}

      <p className="automation-schedule-timezone">游戏服务区时区 · 每日 04:00 刷新游戏日</p>
    </SmoothPanel>
  )
}
