interface TaskStatusResponse {
  success?: boolean
  data?: { isRunning?: boolean }
}

interface WaitForTaskIdleOptions {
  signal?: AbortSignal
  pollIntervalMs?: number
  timeoutMs?: number
}

const waitForDelay = (delayMs: number, signal?: AbortSignal) => new Promise<boolean>(resolve => {
  if (signal?.aborted) {
    resolve(false)
    return
  }

  const timer = window.setTimeout(() => {
    signal?.removeEventListener('abort', handleAbort)
    resolve(true)
  }, delayMs)
  const handleAbort = () => {
    window.clearTimeout(timer)
    signal?.removeEventListener('abort', handleAbort)
    resolve(false)
  }
  signal?.addEventListener('abort', handleAbort, { once: true })
})

export async function waitForTaskIdle(
  getStatus: (signal?: AbortSignal) => Promise<TaskStatusResponse>,
  {
    signal,
    pollIntervalMs = 400,
    timeoutMs = 15_000,
  }: WaitForTaskIdleOptions = {},
) {
  const deadline = Date.now() + timeoutMs

  while (!signal?.aborted && Date.now() <= deadline) {
    try {
      const result = await getStatus(signal)
      if (result.success && result.data?.isRunning === false) return true
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) return false
    }

    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    if (!await waitForDelay(Math.min(pollIntervalMs, remaining), signal)) return false
  }

  return false
}
