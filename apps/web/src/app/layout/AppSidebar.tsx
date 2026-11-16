import { useEffect, useState, type CSSProperties } from 'react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/shared/ui/sidebar'
import type { AppTab } from '@/shared/navigation'
import { appTabs, type AppTabDefinition } from '../router/tabs'
import {
  DEFAULT_OPERATOR_QUOTE,
  getOperatorAvatarUrl,
  loadDailyOperatorQuote,
} from '@/features/operator-quotes'
import { useItemIconCacheVersion } from '@/features/game-data'

interface AppSidebarProps {
  activeTab: AppTab
  onNavigate: (tab: AppTab) => void
}

function SidebarTabButton({
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
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        data-app-tab={tab.id}
        aria-current={active ? 'page' : undefined}
        onClick={() => onNavigate(tab.id)}
      >
        <Icon aria-hidden="true" />
        <span>{tab.name}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export default function AppSidebar({ activeTab, onNavigate }: AppSidebarProps) {
  const [sidebarIdentity, setSidebarIdentity] = useState(DEFAULT_OPERATOR_QUOTE)
  const itemIconVersion = useItemIconCacheVersion()

  useEffect(() => {
    let subscribed = true

    void loadDailyOperatorQuote().then((quote) => {
      if (subscribed) setSidebarIdentity(quote)
    }).catch(() => undefined)

    return () => {
      subscribed = false
    }
  }, [])

  return (
    <aside data-region="sidebar" className="la-pluma-sidebar" aria-label="主要功能">
      <SidebarProvider
        className="contents"
        style={{ '--sidebar-width': 'var(--layout-sidebar-width)' } as CSSProperties}
      >
        <Sidebar className="la-pluma-sidebar-body">
          <SidebarHeader>
            <div data-region="sidebar-brand" className="la-pluma-sidebar-brand">
              <img
                src={`${import.meta.env.BASE_URL}logo-graphite.svg?v=1`}
                alt=""
                draggable={false}
                className="la-pluma-sidebar-brand-mark"
              />
              <span>La Pluma Next</span>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <nav
                  id="app-sidebar-navigation"
                  aria-label="工作台"
                  tabIndex={-1}
                  className="la-pluma-sidebar-nav"
                >
                  <SidebarMenu>
                    {appTabs.map(tab => (
                      <SidebarTabButton key={tab.id} tab={tab} active={activeTab === tab.id} onNavigate={onNavigate} />
                    ))}
                  </SidebarMenu>
                </nav>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="la-pluma-sidebar-footer">
            <div
              className="la-pluma-sidebar-identity"
              aria-label={`${sidebarIdentity.operator}：${sidebarIdentity.quote}`}
            >
              <span className="la-pluma-sidebar-avatar" aria-hidden="true">
                <img
                  key={sidebarIdentity.operatorId}
                  src={getOperatorAvatarUrl(sidebarIdentity.operatorId, 'base', itemIconVersion)}
                  alt=""
                  decoding="async"
                  onError={(event) => {
                    const target = event.currentTarget
                    if (target.dataset.fallbackApplied === 'true') return
                    target.dataset.fallbackApplied = 'true'
                    target.src = `${import.meta.env.BASE_URL}logo-graphite.svg?v=1`
                  }}
                />
              </span>
              <span className="la-pluma-sidebar-identity-copy">
                <strong title={sidebarIdentity.operator}>{sidebarIdentity.operator}</strong>
                <small title={sidebarIdentity.quote}>{sidebarIdentity.quote}</small>
              </span>
            </div>
          </SidebarFooter>
        </Sidebar>
      </SidebarProvider>
    </aside>
  )
}
