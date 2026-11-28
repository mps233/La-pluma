/// <reference types="vite/client" />
// @vitest-environment node

import { describe, expect, it } from 'vitest'

/**
 * DESIGN.md's token contract: primitive tokens are the only layer that writes
 * colour literals; semantic and component tokens reference them. The status
 * pulse is the one dynamic exception because its RGB channels are chosen at
 * runtime.
 */
const sources = import.meta.glob('../{index,ios-theme}.css', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const colorLiteral = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/
const primitiveDefinition = /^\s*--la-(?:base-)?[a-z0-9-]+:/

describe('token layer boundary', () => {
  it('keeps colour literals inside primitive definitions', () => {
    const violations: string[] = []
    for (const [path, source] of Object.entries(sources)) {
      source.split('\n').forEach((line, index) => {
        // rgb(var(--status-pulse-rgb)) is a runtime channel reference, not a literal.
        const scrubbed = line.replace(/rgba?\(var\(--[^)]+\)\)/g, '')
        if (!colorLiteral.test(scrubbed)) return
        if (primitiveDefinition.test(line)) return
        violations.push(`${path}:${index + 1}: ${line.trim()}`)
      })
    }
    expect(violations).toEqual([])
  })

  it('covers both theme files', () => {
    expect(Object.keys(sources).sort()).toEqual(['../index.css', '../ios-theme.css'])
  })
})
