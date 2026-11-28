/// <reference types="vite/client" />
// @vitest-environment node

import { describe, expect, it } from 'vitest'

/**
 * Brand and semantic colors must come from the tokens in index.css /
 * ios-theme.css. This is a ratchet: files below still contain literals that
 * need a product/design decision, but no other file may add one. Shrink the
 * list as each file moves to semantic classes/tokens.
 */
const legacyColorFiles = [
  // A 40-hue user-selectable tool palette; replacing it changes a product
  // feature, so it waits for PD6 rather than being silently narrowed.
  'components/CustomTools.tsx',
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
