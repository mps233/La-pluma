import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Download, RefreshCw, Share2, SquarePlus } from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useStatusStore } from '@/store/statusStore'
import { Button, IconButton } from '@/components/common'
import { hasDocumentBuildChanged } from '@/utils/pwaUpdate'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean
}

const INSTALL_DISMISS_KEY = 'pwa-install-dismissed-at'
const INSTALL_REMINDER_DELAY_MS = 7 * 24 * 60 * 60 * 1000
const UPDATE_CHECK_INTERVAL_MS = 60 * 1000

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches
  || (window.navigator as NavigatorWithStandalone).standalone === true

const isIosDevice = () => {
  const { userAgent, maxTouchPoints } = window.navigator
  return /iPad|iPhone|iPod/i.test(userAgent)
    || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)
}

const canOfferInstallation = () =>
  window.isSecureContext
  || ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)

const isCompactInstallViewport = () =>
  window.matchMedia('(max-width: 639px)').matches

const shouldRemindAboutInstall = () => {
  try {
    const dismissedAt = Number(window.localStorage.getItem(INSTALL_DISMISS_KEY))
    return !Number.isFinite(dismissedAt)
      || dismissedAt <= 0
      || Date.now() - dismissedAt >= INSTALL_REMINDER_DELAY_MS
  } catch {
    return true
  }
}

const rememberInstallDismissal = () => {
  try {
    window.localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()))
  } catch {
    // Installation remains available when storage is unavailable.
  }
}

const clearInstallDismissal = () => {
  try {
    window.localStorage.removeItem(INSTALL_DISMISS_KEY)
  } catch {
    // Nothing else is required when storage is unavailable.
  }
}

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isIos] = useState(isIosDevice)
  const [showInstallPrompt, setShowInstallPrompt] = useState(() =>
    !isStandalone()
    && canOfferInstallation()
    && isIosDevice()
    && shouldRemindAboutInstall())
  const [isInstallExpanded, setIsInstallExpanded] = useState(() => !isCompactInstallViewport())
  const [isUpdateCollapsed, setIsUpdateCollapsed] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const serviceWorkerRegistrationRef = useRef<ServiceWorkerRegistration | null>(null)
  const lastUpdateCheckRef = useRef(0)
  const shouldReduceMotion = useReducedMotion()
  const setStatusMessage = useStatusStore(state => state.setMessage)

  const handleOfflineReady = useCallback(() => {
    setStatusMessage('界面已准备好；自动化操作仍需连接服务', 'success')
  }, [setStatusMessage])

  const handleRegisterError = useCallback(() => {
    setStatusMessage('应用安装服务启动失败，请刷新页面重试', 'error')
  }, [setStatusMessage])

  const handleRegisteredSW = useCallback((
    _swScriptUrl: string,
    registration: ServiceWorkerRegistration | undefined,
  ) => {
    serviceWorkerRegistrationRef.current = registration ?? null
  }, [])

  const checkForApplicationUpdate = useCallback(() => {
    if (!window.navigator.onLine) return

    const now = Date.now()
    if (now - lastUpdateCheckRef.current < UPDATE_CHECK_INTERVAL_MS) return
    lastUpdateCheckRef.current = now

    const registration = serviceWorkerRegistrationRef.current
    if (registration) {
      void registration.update().catch(() => {
        // A transient update check failure must not interrupt the current UI.
      })
      return
    }

    void hasDocumentBuildChanged().then((hasChanged) => {
      if (hasChanged) window.location.reload()
    }).catch(() => {
      // A transient update check failure must not interrupt the current UI.
    })
  }, [])

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onOfflineReady: handleOfflineReady,
    onRegisteredSW: handleRegisteredSW,
    onRegisterError: handleRegisterError,
  })

  useEffect(() => {
    const checkWhenVisible = () => {
      if (document.visibilityState === 'visible') checkForApplicationUpdate()
    }

    window.addEventListener('pageshow', checkWhenVisible)
    document.addEventListener('visibilitychange', checkWhenVisible)
    return () => {
      window.removeEventListener('pageshow', checkWhenVisible)
      document.removeEventListener('visibilitychange', checkWhenVisible)
    }
  }, [checkForApplicationUpdate])

  useEffect(() => {
    if (isStandalone() || !canOfferInstallation()) return

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()
      const promptEvent = e as BeforeInstallPromptEvent
      setDeferredPrompt(promptEvent)
      if (shouldRemindAboutInstall()) {
        setIsInstallExpanded(!isCompactInstallViewport())
        setShowInstallPrompt(true)
      }
    }

    const handleAppInstalled = () => {
      clearInstallDismissal()
      setDeferredPrompt(null)
      setShowInstallPrompt(false)
      setIsInstallExpanded(false)
      setStatusMessage('La Pluma 已安装', 'success')
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [setStatusMessage])

  const handleInstall = async () => {
    if (!deferredPrompt) return

    try {
      await deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === 'dismissed') rememberInstallDismissal()
      else clearInstallDismissal()
      setDeferredPrompt(null)
      setShowInstallPrompt(false)
      setIsInstallExpanded(false)
    } catch {
      setStatusMessage('未能打开安装窗口，请稍后重试', 'error')
    }
  }

  const handleInstallDismiss = () => {
    rememberInstallDismissal()
    setShowInstallPrompt(false)
    setIsInstallExpanded(false)
  }

  const handleUpdate = async () => {
    setIsUpdating(true)
    try {
      await updateServiceWorker(true)
    } catch {
      setStatusMessage('更新失败，请检查连接后重试', 'error')
    } finally {
      setIsUpdating(false)
    }
  }

  const showUpdateCard = needRefresh && !isUpdateCollapsed
  const showInstallCard = !needRefresh && showInstallPrompt && isInstallExpanded
  const showInstallEntry = !needRefresh && showInstallPrompt && !isInstallExpanded
  const announcement = showUpdateCard
    ? '发现新版本，可以立即更新'
    : showInstallPrompt
      ? (isIos ? '可以将 La Pluma 添加到主屏幕' : '可以安装 La Pluma')
      : ''
  const logoUrl = `${import.meta.env.BASE_URL}logo-graphite.svg?v=1`

  return (
    <>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>

      <AnimatePresence>
        {(showUpdateCard || showInstallCard) && (
          <motion.section
            key={showUpdateCard ? 'update' : 'install'}
            role="region"
            aria-labelledby="pwa-prompt-title"
            aria-busy={showUpdateCard && isUpdating}
            initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
            transition={{ duration: shouldReduceMotion ? 0.08 : 0.18, ease: 'easeOut' }}
            className="pwa-install-prompt surface-panel fixed z-50 rounded-xl p-4 shadow-xl sm:w-96"
          >
            <div className="flex items-start gap-3">
              <img
                src={logoUrl}
                alt=""
                aria-hidden="true"
                className="h-11 w-11 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <h2 id="pwa-prompt-title" className="text-base font-semibold text-primary">
                  {showUpdateCard ? '发现新版本' : '安装 La Pluma'}
                </h2>
                <p className="mt-1 text-sm leading-6 text-secondary">
                  {showUpdateCard
                    ? '刷新页面后即可使用最新版本。'
                    : isIos
                      ? '添加到主屏幕后，可以像普通应用一样打开。'
                      : '安装到设备后，可以从桌面快速打开。'}
                </p>

                {showInstallCard && isIos && (
                  <ol className="surface-soft mt-3 space-y-2 rounded-lg p-3 text-xs leading-5 text-secondary">
                    <li className="flex items-center gap-2">
                      <Share2 className="h-4 w-4 shrink-0 brand-text" aria-hidden="true" />
                      在 Safari 工具栏中点击“分享”
                    </li>
                    <li className="flex items-center gap-2">
                      <SquarePlus className="h-4 w-4 shrink-0 brand-text" aria-hidden="true" />
                      选择“添加到主屏幕”
                    </li>
                  </ol>
                )}

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    loading={showUpdateCard && isUpdating}
                    loadingText="更新中..."
                    icon={showUpdateCard
                      ? <RefreshCw className="h-4 w-4" aria-hidden="true" />
                      : <Download className="h-4 w-4" aria-hidden="true" />}
                    onClick={showUpdateCard ? handleUpdate : handleInstall}
                    disabled={showInstallCard && isIos}
                    className={showInstallCard && isIos ? 'hidden' : ''}
                  >
                    {showUpdateCard ? '立即更新' : '安装'}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={showUpdateCard
                      ? () => setIsUpdateCollapsed(true)
                      : handleInstallDismiss}
                    className={showInstallCard && isIos ? 'col-span-2' : ''}
                  >
                    稍后
                  </Button>
                </div>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {showInstallEntry && (
        <motion.div
          initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: shouldReduceMotion ? 0.08 : 0.18, ease: 'easeOut' }}
          className="pwa-install-entry fixed z-50"
        >
          <IconButton
            variant="secondary"
            size="md"
            icon={<SquarePlus className="h-5 w-5" aria-hidden="true" />}
            onClick={() => setIsInstallExpanded(true)}
            className="pwa-install-entry-button"
            title="安装 La Pluma"
            aria-label="安装 La Pluma"
            aria-expanded="false"
          />
        </motion.div>
      )}

      <AnimatePresence>
        {needRefresh && isUpdateCollapsed && (
          <motion.div
            initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="pwa-update-chip fixed z-50"
          >
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className="h-4 w-4 brand-text" aria-hidden="true" />}
              onClick={() => setIsUpdateCollapsed(false)}
            >
              应用更新
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
