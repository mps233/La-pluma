import { Dialog as SheetPrimitive } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Button } from '@/shared/ui/button'
import { BREAKPOINTS } from '@/shared/lib/breakpoints'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from '@/shared/ui/sheet'
import type { CopilotDetailTarget } from '../model/copilotDetail'
import { COPILOT_DETAIL_LAYER_ID } from './combatPanelTypes'
import { DetailBody, DetailPlaceholder } from './CombatCopilotDetailBody'

const MOBILE_DETAIL_QUERY = `(width < ${BREAKPOINTS.sm}px)`
const DESKTOP_SHEET_CLASS = 'fixed inset-y-0 right-0 z-(--layout-z-portal) flex h-full w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-0 overflow-hidden border-l bg-popover text-sm text-popover-foreground shadow-lg outline-none transition duration-200 ease-in-out data-ending-style:translate-x-[2.5rem] data-ending-style:opacity-0 data-starting-style:translate-x-[2.5rem] data-starting-style:opacity-0'
const MOBILE_SHEET_CONTENT_CLASS = 'z-(--layout-z-portal) max-h-(--layout-sheet-max-height) gap-0 overflow-hidden text-sm text-popover-foreground shadow-lg outline-none'

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
  const onCloseRef = useRef(onClose)
  const isOpen = target !== null || loading
  const title = target?.title ?? PENDING_TITLE
  const isModalSheet = isMobile || stacked

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!isOpen || isMobile || stacked) return
    let closing = false
    const requestClose = () => {
      if (closing) return
      closing = true
      onCloseRef.current()
    }
    const handleOutsidePress = (event: MouseEvent) => {
      const panel = document.getElementById(COPILOT_DETAIL_LAYER_ID)
      if (!panel || !(event.target instanceof Node)) return
      if (panel.contains(event.target)) return
      if (event.target instanceof Element
        && event.target.closest('[data-slot="alert-dialog-content"], [data-slot="dialog-content"], [data-slot="sheet-content"]')) {
        return
      }
      requestClose()
    }

    document.addEventListener('pointerdown', handleOutsidePress)
    document.addEventListener('mousedown', handleOutsidePress)
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePress)
      document.removeEventListener('mousedown', handleOutsidePress)
    }
  }, [isMobile, isOpen, stacked])

  const panel = (
    <>
      <header className="flex items-start justify-between gap-2 border-b p-3.5">
        <SheetTitle className="min-w-0 text-base font-semibold text-foreground [overflow-wrap:anywhere]">
          {title}
        </SheetTitle>
        <SheetClose render={<Button size="icon" variant="ghost" aria-label="关闭详情" />}>
          <X aria-hidden="true" />
        </SheetClose>
      </header>
      <div className="combat-copilot-detail-scroll">
        {target ? <DetailBody target={target}>{children}</DetailBody> : <DetailPlaceholder />}
      </div>
    </>
  )

  return (
    <Sheet
      open={isOpen}
      onOpenChange={open => { if (!open) onClose() }}
      modal={isModalSheet}
      disablePointerDismissal={!isModalSheet}
    >
      {isMobile ? (
        <SheetContent
          id={COPILOT_DETAIL_LAYER_ID}
          side="bottom"
          showCloseButton={false}
          aria-modal="true"
          className={MOBILE_SHEET_CONTENT_CLASS}
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {panel}
        </SheetContent>
      ) : (
        <SheetPrimitive.Portal>
          <SheetPrimitive.Popup
            id={COPILOT_DETAIL_LAYER_ID}
            data-slot="sheet-content"
            data-side="right"
            aria-modal={isModalSheet ? 'true' : 'false'}
            initialFocus={() => document.getElementById(COPILOT_DETAIL_LAYER_ID) ?? true}
            className={DESKTOP_SHEET_CLASS}
          >
            {panel}
          </SheetPrimitive.Popup>
        </SheetPrimitive.Portal>
      )}
    </Sheet>
  )
}
