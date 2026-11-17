import { useCallback, useEffect, useState } from 'react'
import { getErrorMessage } from '@/shared/api'
import { captureScreen } from '../api'
import { usePreviewStore } from '../store/previewStore'
import { usePageVisible } from '@/shared/hooks/usePageVisible'

export function usePreviewSnapshotOwner(available = true) {
  const mode = usePreviewStore(state => state.mode)
  const visible = usePageVisible()
  const [attempt, setAttempt] = useState(0)
  const [image, setImage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setImage(null)
    setError(null)
    if (mode !== 'snapshot' || !visible || !available) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let deadline: ReturnType<typeof setTimeout> | undefined
    let request: AbortController | undefined
    const capture = async () => {
      const currentRequest = new AbortController()
      request = currentRequest
      let timedOut = false
      try {
        const aborted = new Promise<never>((_, reject) => {
          currentRequest.signal.addEventListener('abort', () => reject(new Error(
            timedOut ? '截图超时，将自动重试；也可以关闭预览' : '截图已取消'
          )), { once: true })
          deadline = setTimeout(() => {
            timedOut = true
            currentRequest.abort()
          }, 20000)
        })
        const result = await Promise.race([captureScreen('default', currentRequest.signal), aborted])
        if (controller.signal.aborted) return
        if (!result.success || !result.data?.image) throw new Error(getErrorMessage(result))
        setImage(`data:image/png;base64,${result.data.image}`)
        setError(null)
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '截图失败')
      } finally {
        clearTimeout(deadline)
        request = undefined
        if (!controller.signal.aborted) timer = setTimeout(capture, 10000)
      }
    }
    void capture()
    return () => {
      controller.abort()
      request?.abort()
      clearTimeout(deadline)
      clearTimeout(timer)
    }
  }, [mode, visible, available, attempt])

  const retry = useCallback(() => setAttempt(value => value + 1), [])

  return {
    image: mode === 'snapshot' && visible ? image : null,
    error: mode === 'snapshot' ? error : null,
    retry,
  }
}
