import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync(
  fileURLToPath(new URL('./statistics.css', import.meta.url)),
  'utf8',
)

function ruleBody(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const blocks = [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
    .flatMap(match => (match[1] ? [match[1]] : []))
  return blocks.join('\n')
}

describe('statistics scroll surface styles', () => {
  it('hides the native scrollbars of the panel scroll area', () => {
    const surface = ruleBody(CSS, '.data-statistics-scroll-area')
    const webkitScrollbar = ruleBody(CSS, '.data-statistics-scroll-area::-webkit-scrollbar')

    expect(surface).toContain('scrollbar-width: none')
    expect(webkitScrollbar).toContain('display: none')
  })

  it('draws the scroll indicator outside the content box without intercepting input', () => {
    const indicator = ruleBody(CSS, '.data-statistics-scroll-indicator')

    expect(indicator).toContain('position: absolute')
    expect(indicator).toContain('right: -0.5rem')
    expect(indicator).toContain('pointer-events: none')
  })

  it('keeps the capped panel scroll surface contract', () => {
    const surface = ruleBody(CSS, '.data-statistics-scroll-area')

    expect(surface).toContain('max-height: 60svh')
    expect(surface).toContain('overflow: hidden auto')
    expect(surface).toContain('overscroll-behavior: contain')
  })
})
