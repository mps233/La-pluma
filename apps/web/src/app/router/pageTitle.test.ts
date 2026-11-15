import { describe, expect, it } from 'vitest'
import { APP_TABS, type AppTab } from '@/shared/navigation'
import { resolvePageTitle } from './pageTitle'
import { appTabs } from './tabs'

describe('resolvePageTitle', () => {
  it('uses the active tab name for app routes', () => {
    expect(resolvePageTitle('/app/dashboard', 'dashboard')).toBe('概览')
    expect(resolvePageTitle('/app/automation', 'automation')).toBe('日常')
    expect(resolvePageTitle('/app/config', 'config')).toBe('配置')
  })

  it('matches every app tab name from the shared tab list', () => {
    for (const tab of APP_TABS) {
      const definition = appTabs.find(item => item.id === tab)
      expect(resolvePageTitle(`/app/${tab}`, tab)).toBe(definition?.name)
    }
  })

  it('labels dev routes as the theme gallery', () => {
    expect(resolvePageTitle('/dev/theme-gallery', 'dashboard')).toBe('主题画廊')
    expect(resolvePageTitle('/dev', 'logs')).toBe('主题画廊')
  })

  it('falls back to the overview title for an unknown tab', () => {
    expect(resolvePageTitle('/app/unknown', 'unknown' as AppTab)).toBe('概览')
  })
})
