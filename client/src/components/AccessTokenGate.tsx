import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { isDesktopRuntime } from '@/desktop/bridge'
import { AUTH_REQUIRED_EVENT } from '@/utils/accessToken'

// The dialog pulls in the shared modal animation library. Keep the listener
// tiny and load the dialog only after a 401 asks for a token.
const AccessTokenModal = lazy(() => import('./AccessTokenModal'))

const EXIT_MS = 260

export default function AccessTokenGate() {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [instance, setInstance] = useState(0)
  const closeTimer = useRef<number | null>(null)

  useEffect(() => {
    if (isDesktopRuntime()) return undefined
    const handleAuthRequired = () => {
      if (closeTimer.current !== null) {
        window.clearTimeout(closeTimer.current)
        closeTimer.current = null
      }
      setInstance(value => value + 1)
      setMounted(true)
      setOpen(true)
    }
    window.addEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired)
    return () => {
      window.removeEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired)
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    }
  }, [])

  if (isDesktopRuntime() || !mounted) return null

  const close = () => {
    setOpen(false)
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      setMounted(false)
    }, EXIT_MS)
  }

  return (
    <Suspense fallback={null}>
      <AccessTokenModal key={instance} isOpen={open} onClose={close} />
    </Suspense>
  )
}
