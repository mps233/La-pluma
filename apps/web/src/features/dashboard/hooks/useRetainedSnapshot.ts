import { useEffect, useState } from 'react'

const SNAPSHOT_FADE_MS = 200

export function useRetainedSnapshot(snapshot: string | null, active: boolean) {
  const visible = Boolean(snapshot && active)
  const [retained, setRetained] = useState<string | null>(null)

  if (visible && snapshot !== retained) {
    setRetained(snapshot)
  }

  useEffect(() => {
    if (visible) return
    const timer = window.setTimeout(() => setRetained(null), SNAPSHOT_FADE_MS)
    return () => window.clearTimeout(timer)
  }, [visible])

  return { snapshot: visible ? snapshot : retained, visible }
}
