import { isDevRoutePathname, type AppTab } from '@/shared/navigation'
import { appTabs } from './tabs'

const FALLBACK_PAGE_TITLE = '概览'

export function resolvePageTitle(pathname: string, activeTab: AppTab): string {
  if (isDevRoutePathname(pathname)) return '主题画廊'
  return appTabs.find(tab => tab.id === activeTab)?.name ?? FALLBACK_PAGE_TITLE
}
