export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return String(error)
}

export function getResponseErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const response = (error as { response?: { data?: { error?: unknown } } }).response
  const message = response?.data?.error
  return typeof message === 'string' ? message : null
}
