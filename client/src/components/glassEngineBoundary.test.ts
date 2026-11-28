// @vitest-environment node

import { describe, expect, it } from 'vitest'

/**
 * The heavy glass engine is reached through the deferred layer/lens wrappers.
 * Host components must not import the engine modules statically.
 */
const sources = import.meta.glob(
  [
    './liquid-glass/glass-button.tsx',
    './liquid-glass/glass-action-button.tsx',
    './liquid-glass/glass-card.tsx',
    './liquid-glass/glass-button-group.tsx',
    './liquid-glass/glass-tabs.tsx',
    './liquid-glass/glass-layer-lazy.tsx',
    './liquid-glass/glass-lens-lazy.tsx',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

describe('glass engine boundary', () => {
  it('routes hosts through the deferred layer and lens wrappers', () => {
    for (const name of [
      './liquid-glass/glass-button.tsx',
      './liquid-glass/glass-action-button.tsx',
      './liquid-glass/glass-card.tsx',
      './liquid-glass/glass-button-group.tsx',
    ]) {
      expect(sources[name]).toContain("from './glass-layer-lazy'")
    }
    expect(sources['./liquid-glass/glass-tabs.tsx']).toContain("from './glass-lens-lazy'")
    expect(sources['./liquid-glass/glass-layer-lazy.tsx']).toContain("import('./glass-layer')")
    expect(sources['./liquid-glass/glass-lens-lazy.tsx']).toContain("import('./glass-lens')")
  })
})
