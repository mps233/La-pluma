import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SOURCE_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const DEVICE_MIRROR_CSS = join(
  SOURCE_ROOT,
  'features/device-mirror/styles/device-mirror.css',
)
const SOURCE_EXTENSIONS = new Set(['.css', '.ts', '.tsx'])
const LEGACY_MONITOR_CLASS_RE =
  /automation-monitor-|automation-preview-glass-button|combat-monitor-|roguelike-monitor-(?:panel|surface|column)/g

function webPath(file: string): string {
  return relative(SOURCE_ROOT, file).split(sep).join('/')
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return collectSourceFiles(path)
    if (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) return []
    return SOURCE_EXTENSIONS.has(extname(path)) ? [path] : []
  })
}

describe('device monitor naming', () => {
  it('keeps legacy monitor class fragments out of production source', () => {
    const problems = collectSourceFiles(SOURCE_ROOT).flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return [...source.matchAll(LEGACY_MONITOR_CLASS_RE)].map(
        match => `${webPath(file)}:${lineOf(source, match.index ?? 0)}: ${match[0]}`,
      )
    })

    expect(problems, problems.join('\n')).toEqual([])
  })

  it('does not switch device monitor styles on page kind', () => {
    const source = readFileSync(DEVICE_MIRROR_CSS, 'utf8')

    expect(source).not.toContain('data-page-kind')
  })

  it('keeps the shared preview surface flat', () => {
    const sources = collectSourceFiles(join(SOURCE_ROOT, 'features/device-mirror'))
    const problems = sources.flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return ['device-preview-glass-button', '--glass-', 'backdrop-filter']
        .filter(fragment => source.includes(fragment))
        .map(fragment => `${webPath(file)}: ${fragment}`)
    })

    expect(problems, problems.join('\n')).toEqual([])
  })
})
