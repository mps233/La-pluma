const FILE_SIZE_UNITS = ['B', 'KB', 'MB', 'GB'] as const

export function formatLogFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-'

  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < FILE_SIZE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${FILE_SIZE_UNITS[unit]}`
}
