// @vitest-environment node

import { describe, expect, it } from 'vitest'

/**
 * The island provider, surface, activity adapters, islandcn visuals, and the
 * hugeicons package are one lazy chunk. Keep them out of the entry imports.
 */
const sources = import.meta.glob(['../App.tsx', './Layout.tsx', './IslandHost.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('island boundary', () => {
  it('keeps the island subsystem out of the entry components', () => {
    const app = sources['../App.tsx'] ?? ''
    const layout = sources['./Layout.tsx'] ?? ''
    const host = sources['./IslandHost.tsx'] ?? ''

    expect(app).not.toContain('@/lib/island')
    expect(layout).not.toContain('@/lib/island')
    expect(layout).not.toContain('IslandContext')
    for (const name of ['RunIsland', 'MaaUpdateIsland', 'MasteryIsland', 'SanityBatteryIsland']) {
      expect(layout).not.toContain(`./${name}`)
    }
    expect(host).toContain("lazy(() => import('./IslandLayer'))")
  })
})
