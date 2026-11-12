import { useSyncExternalStore } from 'react'

const readOnlineStatus = () => typeof navigator === 'undefined' || navigator.onLine

const subscribeOnlineStatus = (onStoreChange: () => void) => {
  window.addEventListener('online', onStoreChange)
  window.addEventListener('offline', onStoreChange)
  return () => {
    window.removeEventListener('online', onStoreChange)
    window.removeEventListener('offline', onStoreChange)
  }
}

export function useOnlineStatus() {
  return useSyncExternalStore(subscribeOnlineStatus, readOnlineStatus, readOnlineStatus)
}
