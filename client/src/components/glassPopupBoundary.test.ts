// @vitest-environment node

import { describe, expect, it } from 'vitest'

/**
 * GlassButtonGroup needs the popup contract but not the popup engine. Keep the
 * anchor/context in the light module so the heavy surface stays lazy.
 */
const sources = import.meta.glob(
  ['./liquid-glass/glass-button-group.tsx', './liquid-glass/glass-popup-anchor.tsx'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

describe('glass popup boundary', () => {
  it('keeps button groups on the lightweight anchor', () => {
    const group = sources['./liquid-glass/glass-button-group.tsx'] ?? ''
    const anchor = sources['./liquid-glass/glass-popup-anchor.tsx'] ?? ''

    expect(group).toContain("from './glass-popup-anchor'")
    expect(group).not.toContain("from './glass-popup'")
    expect(anchor).toContain("import type { GlassPopup } from './glass-popup'")
  })
})
