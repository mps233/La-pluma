// @vitest-environment node

import { describe, expect, it } from 'vitest'

/**
 * The glass menu kit (popup, menu, select foundations) must stay behind the
 * lazy GlassMenu boundary; LayoutGlassChrome only renders the placeholder.
 */
const sources = import.meta.glob(['./LayoutGlassChrome.tsx', './GlassMenuImpl.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('glass menu boundary', () => {
  it('keeps the menu kit behind the lazy GlassMenu boundary', () => {
    const chrome = sources['./LayoutGlassChrome.tsx'] ?? ''
    const impl = sources['./GlassMenuImpl.tsx'] ?? ''

    expect(chrome).not.toContain('GlassDropdownMenu')
    expect(chrome).not.toContain('@ui-sdk')
    expect(chrome).toContain("lazy(() => import('./GlassMenuImpl'))")
    expect(impl).toContain('@/components/glass')
  })
})
