/// <reference types="vite/client" />
// @vitest-environment node

import { describe, expect, it } from 'vitest'

/**
 * Brand and semantic colors must come from the tokens in index.css /
 * ios-theme.css. This is a ratchet: the files below already contain literals
 * that need a visual migration, but no new file may add one. Shrink the list
 * as pages move to semantic classes/tokens.
 */
const legacyColorFiles = [
  'components/Dashboard.tsx',
  'components/DashboardPreviewEntry.tsx',
  'components/backgrounds/AsciiFieldBackdrop.tsx',
  'components/common/GlassLiveCardButton.tsx',
  'components/common/StatusMark.tsx',
  'components/common/Switch.tsx',
  'components/CustomTools.tsx',
  'hooks/useThemeAccent.ts',
  'state/uiStore.ts',
]

const sources = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const ignoredDirectories = ['liquid-glass', 'islandcn', 'lib/island']
const colorLiteral = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/

describe('theme color boundary', () => {
  it('allows color literals only in the migration allowlist', () => {
    const violations: string[] = []
    for (const [path, source] of Object.entries(sources)) {
      if (path.includes('.test.') || path.endsWith('.d.ts')) continue
      if (ignoredDirectories.some(directory => path.includes(directory))) continue
      if (legacyColorFiles.some(file => path.endsWith(file))) continue
      source.split('\n').forEach((line, index) => {
        if (colorLiteral.test(line)) {
          violations.push(`${path}:${index + 1}: ${line.trim()}`)
        }
      })
    }
    expect(violations).toEqual([])
  })
})
