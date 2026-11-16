import { useEffect, useState } from 'react'
import { Ellipsis, X } from 'lucide-react'
import { BREAKPOINTS } from '@/shared/lib/breakpoints'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/shared/ui/sheet'
import { cn } from '@/shared/lib/utils'
import type { AppTab } from '@/shared/navigation'
import { appTabs, type AppTabDefinition } from '../router/tabs'

const mobileTabs = appTabs.filter(tab => ['dashboard', 'automation', 'combat', 'config'].includes(tab.id))
const overflowTabs = appTabs.filter(tab => !mobileTabs.some(primary => primary.id === tab.id))

interface AppTabbarProps {
  activeTab: AppTab
  onNavigate: (tab: AppTab) => void
}

function TabbarLink({
  tab,
  active,
  onNavigate,
}: {
  tab: AppTabDefinition
  active: boolean
  onNavigate: (tab: AppTab) => void
}) {
  const Icon = tab.icon
  return (
    <button
      type="button"
      data-app-tab={tab.id}
      aria-current={active ? 'page' : undefined}
      onClick={() => onNavigate(tab.id)}
      className={cn('la-pluma-tabbar-link', active && 'is-active')}
    >
      <Icon aria-hidden="true" />
      <span className="la-pluma-tabbar-label">{tab.name}</span>
    </button>
  )
}

export default function AppTabbar({ activeTab, onNavigate }: AppTabbarProps) {
  const [moreOpen, setMoreOpen] = useState(false)
  const isOverflowActive = overflowTabs.some(tab => tab.id === activeTab)

  const navigateFromSheet = (tab: AppTab) => {
    setMoreOpen(false)
    onNavigate(tab)
  }

  useEffect(() => {
    const desktopQuery = window.matchMedia(`(width >= ${BREAKPOINTS.lg}px)`)
    const closeOnDesktop = (event?: MediaQueryListEvent) => {
      if (event?.matches ?? desktopQuery.matches) setMoreOpen(false)
    }

    if (typeof desktopQuery.addEventListener === 'function') {
      desktopQuery.addEventListener('change', closeOnDesktop)
    } else {
      desktopQuery.addListener(closeOnDesktop)
    }
    closeOnDesktop()

    return () => {
      if (typeof desktopQuery.removeEventListener === 'function') {
        desktopQuery.removeEventListener('change', closeOnDesktop)
      } else {
        desktopQuery.removeListener(closeOnDesktop)
      }
    }
  }, [])

  return (
    <footer data-region="tabbar" className="la-pluma-tabbar">
      <div className="la-pluma-tabbar-inner">
        <nav className="la-pluma-tabbar-pill" aria-label="主要功能">
          {mobileTabs.map(tab => (
            <TabbarLink key={tab.id} tab={tab} active={activeTab === tab.id} onNavigate={onNavigate} />
          ))}
        </nav>
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger
            aria-label="更多页面"
            className={cn('la-pluma-tabbar-more', (isOverflowActive || moreOpen) && 'is-active')}
          >
            <Ellipsis aria-hidden="true" />
          </SheetTrigger>
          <SheetContent side="bottom" showCloseButton={false} className="la-pluma-more-sheet">
            <SheetHeader className="la-pluma-more-sheet-header flex-row items-start justify-between gap-3.5 p-0 pt-0.5">
              <SheetTitle>更多工作区</SheetTitle>
              <SheetClose aria-label="关闭更多工作区" className="la-pluma-more-sheet-close">
                <X aria-hidden="true" />
              </SheetClose>
            </SheetHeader>
            <nav aria-label="更多功能" className="la-pluma-more-sheet-nav">
              {overflowTabs.map(tab => (
                <TabbarLink key={tab.id} tab={tab} active={activeTab === tab.id} onNavigate={navigateFromSheet} />
              ))}
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </footer>
  )
}
