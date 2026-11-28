export interface ScheduleTimeEntry {
  time: string
  enabled: boolean
}

export const DEFAULT_SCHEDULE_ENTRIES: ScheduleTimeEntry[] = [
  { time: '08:00', enabled: true },
  { time: '14:00', enabled: true },
  { time: '20:00', enabled: true },
]

const scheduleTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/

export const normalizeScheduleTimes = (times: string[]) => (
  [...new Set(times.filter(time => scheduleTimePattern.test(time)))]
)

export const formatScheduleTime = (hour: number, minute: number) => (
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
)

export const parseScheduleTime = (time: string) => {
  const [hourText = '0', minuteText = '0'] = time.split(':')
  const hour = Number(hourText)
  const minute = Number(minuteText)
  return {
    hour: Number.isFinite(hour) ? Math.min(23, Math.max(0, hour)) : 0,
    minute: Number.isFinite(minute) ? Math.min(59, Math.max(0, minute)) : 0,
  }
}

export const normalizeScheduleEntries = (entries: ScheduleTimeEntry[]) => {
  const normalized: ScheduleTimeEntry[] = []
  const seen = new Set<string>()

  for (const entry of entries) {
    if (!scheduleTimePattern.test(entry.time) || seen.has(entry.time)) continue
    seen.add(entry.time)
    normalized.push({ time: entry.time, enabled: entry.enabled !== false })
  }

  return normalized
}

export const scheduleEntriesFromTimes = (times: string[]) => (
  normalizeScheduleEntries(
    normalizeScheduleTimes(times).map(time => ({ time, enabled: true })),
  )
)

export const activeScheduleTimes = (entries: ScheduleTimeEntry[]) => (
  entries.filter(entry => entry.enabled).map(entry => entry.time)
)

export const readScheduleEntries = (schedule: { times?: unknown, entries?: unknown } | null | undefined) => {
  if (Array.isArray(schedule?.entries)) {
    const fromEntries = normalizeScheduleEntries(
      schedule.entries
        .map((entry: unknown) => {
          if (typeof entry === 'string') return { time: entry, enabled: true }
          if (!entry || typeof entry !== 'object') return null
          const record = entry as { time?: unknown, enabled?: unknown }
          if (typeof record.time !== 'string') return null
          return { time: record.time, enabled: record.enabled !== false }
        })
        .filter((entry): entry is ScheduleTimeEntry => Boolean(entry)),
    )
    if (fromEntries.length > 0) return fromEntries
  }

  if (Array.isArray(schedule?.times)) {
    return scheduleEntriesFromTimes(
      schedule.times.filter((time): time is string => typeof time === 'string'),
    )
  }

  return []
}
