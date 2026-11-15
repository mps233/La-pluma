import { useContext, useSyncExternalStore, type CSSProperties } from 'react'
import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react'
import { Toaster } from 'sonner'
import { ThemeContext } from '@/shared/theme/useTheme'

const DESKTOP_QUERY = '(min-width: 1024px)'
const TABBAR_TOAST_BOTTOM = 'calc(var(--la-pluma-tabbar-reserved-height, 5rem) + env(safe-area-inset-bottom, 0px) + 1rem)'

function subscribeDesktop(callback: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {}
  const media = window.matchMedia(DESKTOP_QUERY)
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}

function getDesktopSnapshot() {
  return typeof window.matchMedia === 'function' && window.matchMedia(DESKTOP_QUERY).matches
}

export function AppToaster() {
  const theme = useContext(ThemeContext)?.resolvedMode ?? 'system'
  const desktop = useSyncExternalStore(subscribeDesktop, getDesktopSnapshot, () => false)
  const bottom = desktop ? 24 : TABBAR_TOAST_BOTTOM

  return (
    <Toaster
      theme={theme}
      position="bottom-center"
      offset={{ bottom }}
      mobileOffset={{ bottom }}
      visibleToasts={3}
      closeButton
      className="max-[600px]:w-[calc(100vw-2rem)]!"
      toastOptions={{
        closeButtonAriaLabel: '关闭通知',
        classNames: {
          toast: 'cn-toast left-0! right-0! mx-auto! w-max! max-w-[calc(100vw-2rem)]!',
        },
      }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={{
        '--normal-bg': 'var(--popover)',
        '--normal-text': 'var(--popover-foreground)',
        '--normal-border': 'var(--border)',
        '--border-radius': 'var(--radius)',
      } as CSSProperties}
    />
  )
}
