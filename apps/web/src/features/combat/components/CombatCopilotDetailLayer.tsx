import { X } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/shared/ui/button'
import { useModalLayer } from '@/shared/components'
import { Modal } from '@/shared/components/Modal'
import type { CopilotDetailTarget } from '../model/copilotDetail'
import { COPILOT_DETAIL_LAYER_ID } from './combatPanelTypes'
import { DetailBody, DetailPlaceholder } from './CombatCopilotDetailBody'

const MOBILE_DETAIL_QUERY = '(max-width: 40rem)'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(element => element.getAttribute('aria-hidden') !== 'true')
}

export interface CombatCopilotDetailLayerProps {
  target: CopilotDetailTarget | null
  onClose: () => void
  stacked?: boolean
  /** 目标尚未读出：先显示抽屉壳与加载态，避免点开与内容出现之间留白。 */
  loading?: boolean
  children?: ReactNode
}

const PENDING_TITLE = '作业详情'

function useMobileDetailLayout(): boolean {
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(MOBILE_DETAIL_QUERY).matches
      : false
  ))

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(MOBILE_DETAIL_QUERY)
    const update = () => setIsMobile(query.matches)
    update()
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])

  return isMobile
}

export default function CombatCopilotDetailLayer({
  target,
  onClose,
  stacked = false,
  loading = false,
  children,
}: CombatCopilotDetailLayerProps) {
  const isMobile = useMobileDetailLayout()
  const generatedId = useId().replace(/:/g, '')
  const titleId = `combat-copilot-detail-title-${generatedId}`
  const panelRef = useRef<HTMLElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)

  const isOpen = target !== null || loading
  const title = target?.title ?? PENDING_TITLE
  const isModalDrawer = stacked && isOpen && !isMobile

  useModalLayer(layerRef, isModalDrawer)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!isOpen || isMobile) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus({ preventScroll: true })
    let closing = false
    const requestClose = () => {
      if (closing) return
      closing = true
      onCloseRef.current()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      requestClose()
    }
    const handleOutsidePress = (event: MouseEvent) => {
      const panel = panelRef.current
      if (!panel || !(event.target instanceof Node)) return
      if (panel.contains(event.target) || (event.target instanceof Element && event.target.closest('[data-app-modal-layer]'))) return
      requestClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('pointerdown', handleOutsidePress)
    document.addEventListener('mousedown', handleOutsidePress)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('pointerdown', handleOutsidePress)
      document.removeEventListener('mousedown', handleOutsidePress)
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [isOpen, isMobile])

  useEffect(() => {
    if (!isModalDrawer) return
    const handleTabKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented) return
      const panel = panelRef.current
      const active = document.activeElement
      if (!panel || !(active instanceof Node) || !panel.contains(active)) return
      const focusable = getFocusableElements(panel)
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) {
        event.preventDefault()
        panel.focus({ preventScroll: true })
        return
      }
      const wraps = event.shiftKey
        ? active === first || active === panel
        : active === last || active === panel
      if (!wraps) return
      const target = event.shiftKey ? last : first
      event.preventDefault()
      target.focus({ preventScroll: true })
    }

    document.addEventListener('keydown', handleTabKey)
    return () => document.removeEventListener('keydown', handleTabKey)
  }, [isModalDrawer])

  if (isMobile) {
    return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={title}
        placement="sheet"
        dialogId={COPILOT_DETAIL_LAYER_ID}
        size="lg"
      >
        {target ? <DetailBody target={target}>{children}</DetailBody> : <DetailPlaceholder />}
      </Modal>
    )
  }

  if (!isOpen || typeof document === 'undefined') return null

  return createPortal(
    <div ref={layerRef} className="combat-copilot-detail-layer">
      <aside
        ref={panelRef}
        id={COPILOT_DETAIL_LAYER_ID}
        role="dialog"
        aria-modal={isModalDrawer ? 'true' : 'false'}
        aria-labelledby={titleId}
        tabIndex={-1}
        className="combat-copilot-detail-drawer surface-panel"
      >
        <header className="combat-copilot-detail-head">
          <h2 id={titleId} className="combat-copilot-detail-title">{title}</h2>
          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
            title="关闭详情"
            aria-label="关闭详情"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </header>
        <div className="combat-copilot-detail-scroll">
          {target ? <DetailBody target={target}>{children}</DetailBody> : <DetailPlaceholder />}
        </div>
      </aside>
    </div>,
    document.body,
  )
}
