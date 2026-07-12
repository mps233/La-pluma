import { useEffect, useState } from 'react'

const readOnlineStatus = () => typeof navigator === 'undefined' || navigator.onLine

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(readOnlineStatus)

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return isOnline
}
