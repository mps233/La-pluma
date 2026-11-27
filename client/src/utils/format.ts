/**
 * Display formatting shared by pages and islands.
 *
 * The duration helpers intentionally keep three contracts:
 * - `formatDurationMs` rounds (expanded run summary),
 * - `formatElapsedDuration` floors and rejects invalid input (live panel),
 * - `formatClockDuration` is a monospace-friendly clock (elapsed timers).
 * Do not merge them without changing the rendered copy at the call sites.
 */

/** "48 秒", "3 分 20 秒", "1 小时 5 分". */
export function formatDurationMs(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours} 小时 ${minutes} 分`
  if (minutes > 0) return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`
  return `${seconds} 秒`
}

/** Live elapsed duration, or null when the value is unusable. */
export function formatElapsedDuration(elapsedMs: number | null): string | null {
  if (elapsedMs === null || !Number.isFinite(elapsedMs) || elapsedMs < 0) return null
  const totalSeconds = Math.floor(elapsedMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours} 小时 ${minutes} 分`
  if (minutes > 0) return `${minutes} 分 ${seconds} 秒`
  return `${seconds} 秒`
}

/** "05:32" below an hour, "1:05:32" above. Floors. */
export function formatClockDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

const FULL_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** Full date-time; an unparseable input is returned unchanged. */
export function formatDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : FULL_TIMESTAMP_FORMATTER.format(date)
}

/** Compact date-time; the year is omitted for the current year. "—" when empty/invalid. */
export function formatDateTimeCompact(value: string | null): string {
  if (!value) return '—'
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return '—'
  const date = new Date(time)
  if (date.getFullYear() !== new Date().getFullYear()) {
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Remaining time from a seconds value: "1 小时 5 分" / "5 分钟". */
export function formatRemainingDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '已完成或空闲'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return hours > 0 ? `${hours} 小时 ${minutes} 分` : `${minutes} 分钟`
}

/** Parses a timestamp field that may be missing or malformed. */
export function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}
