// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SOURCE_DIR = join(process.cwd(), 'src')

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return cssFiles(path)
    return entry.name.endsWith('.css') ? [path] : []
  })
}

/** Selectors with :hover that are not inside `@media (hover: hover)`. */
function unguardedHoverSelectors(css: string): string[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const findings: string[] = []
  const stack: string[] = []
  let i = 0

  while (i < source.length) {
    const ch = source[i]
    if (ch === '{') {
      const start = Math.max(
        source.lastIndexOf('}', i - 1),
        source.lastIndexOf(';', i - 1),
        source.lastIndexOf('{', i - 1),
      )
      stack.push(source.slice(start + 1, i).trim())
      i += 1
    } else if (ch === '}') {
      stack.pop()
      i += 1
    } else {
      let end = i
      while (end < source.length && source[end] !== '{' && source[end] !== '}') end += 1
      const chunk = source.slice(i, end)
      if (chunk.includes(':hover') && source[end] === '{') {
        const guarded = stack.some(selector => selector.includes('hover: hover'))
        // Autofill is a field state, not a pointer hover.
        if (!guarded && !chunk.includes('-webkit-autofill:hover')) {
          findings.push(`${chunk.trim()} {`)
        }
      }
      i = end
    }
  }

  return findings
}

describe('touch-safe hover', () => {
  it('keeps every CSS :hover rule behind (hover: hover)', () => {
    const offenders = cssFiles(SOURCE_DIR).flatMap((file) =>
      unguardedHoverSelectors(readFileSync(file, 'utf8'))
        .map(selector => `${relative(SOURCE_DIR, file)}: ${selector}`),
    )

    expect(offenders).toEqual([])
  })
})
