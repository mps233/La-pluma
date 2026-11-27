import { useSyncExternalStore } from 'react'

const COARSE_POINTER_QUERY = '(pointer: coarse)'

function subscribe(callback: () => void) {
  const query = window.matchMedia?.(COARSE_POINTER_QUERY)
  if (!query) return () => {}
  query.addEventListener('change', callback)
  return () => query.removeEventListener('change', callback)
}

const getSnapshot = () => window.matchMedia?.(COARSE_POINTER_QUERY)?.matches === true

/** True on a touch-first device (phone, tablet), false for a mouse or trackpad. */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
