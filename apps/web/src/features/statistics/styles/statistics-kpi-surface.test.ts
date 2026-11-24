import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync(
  fileURLToPath(new URL('./statistics.css', import.meta.url)),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '')

interface CssNode {
  prelude: string
  body: string
}

interface CssRule {
  selector: string
  body: string
  media: string | null
}

function readNodes(css: string): CssNode[] {
  const nodes: CssNode[] = []
  let cursor = 0
  while (cursor < css.length) {
    const open = css.indexOf('{', cursor)
    if (open === -1) break
    let depth = 1
    let end = open + 1
    while (end < css.length && depth > 0) {
      if (css[end] === '{') depth += 1
      else if (css[end] === '}') depth -= 1
      end += 1
    }
    nodes.push({ prelude: css.slice(cursor, open).trim(), body: css.slice(open + 1, end - 1) })
    cursor = end
  }
  return nodes
}

const normalize = (value: string) => value.replace(/\s+/g, ' ').trim()

function collectRules(css: string, media: string | null = null): CssRule[] {
  return readNodes(css).flatMap((node) => {
    if (node.prelude.startsWith('@media')) {
      return collectRules(node.body, normalize(node.prelude.slice('@media'.length)))
    }
    if (node.prelude.startsWith('@layer')) return collectRules(node.body, media)
    if (node.prelude.startsWith('@')) return []
    return node.prelude.split(',').map(selector => ({
      selector: normalize(selector),
      body: node.body,
      media,
    }))
  })
}

const RULES = collectRules(CSS)
const MD_MEDIA = '(width >= 768px)'

const bodyOf = (selector: string, media: string | null = null) => RULES
  .filter(rule => rule.selector === selector && rule.media === media)
  .map(rule => rule.body)
  .join('\n')

describe('statistics KPI surface styles', () => {
  it('keeps the KPI cells opaque so the group seam reaches text contrast', () => {
    const cell = bodyOf('.data-statistics-kpi')

    expect(cell).toContain('background: var(--card)')
    expect(cell).not.toContain('color-mix')
  })

  it('draws the KPI group with real hairlines instead of a gap-filled backdrop', () => {
    const grid = bodyOf('.data-statistics-kpi-grid')

    expect(grid).toContain('border: 1px solid var(--border)')
    expect(grid).toContain('overflow: hidden')
    expect(grid).not.toContain('gap:')
    expect(grid).not.toContain('padding:')
    expect(grid).not.toContain('background: var(--border)')
  })

  it('keeps the hairline between the merged item name and the recognition time', () => {
    const split = bodyOf('.data-statistics-kpi-split > :not(:last-child)')

    expect(split).toContain('border-right: 1px solid var(--border)')
    expect(bodyOf('.data-statistics-kpi-split > *')).toContain('padding: 0.75rem')
  })

  it('draws the base right hairlines between every depot KPI cell', () => {
    const base = bodyOf('.data-statistics-kpi-grid-depot > :not(:last-child)')

    expect(base).toContain('border-right: 1px solid var(--border)')
  })

  it('resets the base right hairlines on every second depot cell', () => {
    expect(bodyOf('.data-statistics-kpi-grid-depot > :nth-child(2n)')).toContain('border-right: 0')
  })

  it('draws the base top hairlines from the second depot row', () => {
    expect(bodyOf('.data-statistics-kpi-grid-depot > :nth-child(n + 3)'))
      .toContain('border-top: 1px solid var(--border)')
  })

  it('restores a right hairline on every second depot cell at the md breakpoint', () => {
    expect(bodyOf('.data-statistics-kpi-grid-depot > :nth-child(2n)', MD_MEDIA))
      .toContain('border-right: 1px solid var(--border)')
  })

  it('drops the right hairline on every third depot cell at the md breakpoint', () => {
    expect(bodyOf('.data-statistics-kpi-grid-depot > :nth-child(3n)', MD_MEDIA))
      .toContain('border-right: 0')
  })

  it('drops the base top hairline from the second depot row at the md breakpoint', () => {
    expect(bodyOf('.data-statistics-kpi-grid-depot > :nth-child(n + 3)', MD_MEDIA))
      .toContain('border-top: 0')
  })

  it('restores the top hairline from the second depot row at the md breakpoint', () => {
    expect(bodyOf('.data-statistics-kpi-grid-depot > :nth-child(n + 4)', MD_MEDIA))
      .toContain('border-top: 1px solid var(--border)')
  })
})
