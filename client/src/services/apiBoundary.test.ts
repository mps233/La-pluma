/// <reference types="vite/client" />
// @vitest-environment node

import { describe, expect, it } from 'vitest'

/**
 * Raw fetch is only allowed in the shared HTTP client. Everything else uses
 * `fetchWithAuth`/`maaApi` from `services/api.ts` or a domain service module
 * that builds on it. The glob is resolved at build time, so this test needs no
 * filesystem access.
 */
const sources = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const isApiClient = (path: string) => (
  path === './api.ts'
  || path.endsWith('/services/api.ts')
  || path === './api/client.ts'
  || path.endsWith('/services/api/client.ts')
)
const ignoredDirectories = ['liquid-glass', 'islandcn']

describe('API boundary', () => {
  it('keeps raw fetch calls inside services/api.ts', () => {
    const violations: string[] = []
    for (const [path, source] of Object.entries(sources)) {
      if (path.includes('.test.') || path.endsWith('.d.ts') || isApiClient(path)) continue
      if (ignoredDirectories.some(directory => path.includes(directory))) continue
      source.split('\n').forEach((line, index) => {
        if (/\bfetch\s*\(/.test(line)) {
          violations.push(`${path}:${index + 1}: ${line.trim()}`)
        }
      })
    }
    expect(violations).toEqual([])
  })
})
