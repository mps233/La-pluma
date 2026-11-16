import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const STYLES_ROOT = fileURLToPath(new URL('.', import.meta.url))

const LAYOUT_TOKEN_DEFINITION_RE = /(--layout-[\w-]+)\s*:/g
const LAYOUT_TOKEN_REFERENCE_RE = /var\(\s*(--layout-[\w-]+)/g
const LEGACY_TOKEN_RE = new RegExp(`${'--la'}-${'pluma'}-` + '[\\w-]+', 'g')

const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.md', '.mjs', '.ts', '.tsx'])
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '__screenshots__',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
])

function collectTextFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    if (IGNORED_DIRECTORIES.has(entry)) return []
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return collectTextFiles(path)
    return TEXT_EXTENSIONS.has(extname(path)) ? [path] : []
  })
}

function matches(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].flatMap(match => (match[1] ? [match[1]] : []))
}

describe('layout style layer', () => {
  it('defines every referenced --layout-* token in layout.css', () => {
    const layoutCss = readFileSync(join(STYLES_ROOT, 'layout.css'), 'utf8')
    const defined = new Set(matches(layoutCss, LAYOUT_TOKEN_DEFINITION_RE))
    const references: Array<{ token: string; file: string }> = []
    const foreignDefinitions: Array<{ token: string; file: string }> = []

    for (const file of collectTextFiles(REPO_ROOT)) {
      const source = readFileSync(file, 'utf8')
      const location = relative(REPO_ROOT, file)
      for (const token of matches(source, LAYOUT_TOKEN_REFERENCE_RE)) {
        references.push({ token, file: location })
      }
      for (const token of matches(source, LAYOUT_TOKEN_DEFINITION_RE)) {
        if (location !== join('apps', 'web', 'src', 'styles', 'layout.css')) {
          foreignDefinitions.push({ token, file: location })
        }
      }
    }

    expect(references.length).toBeGreaterThan(0)
    expect(references.filter(({ token }) => !defined.has(token))).toEqual([])
    expect(foreignDefinitions).toEqual([])
  })

  it('keeps legacy layout tokens out of the repository', () => {
    const legacy = collectTextFiles(REPO_ROOT).flatMap(file => (
      [...readFileSync(file, 'utf8').matchAll(LEGACY_TOKEN_RE)].map(([token]) => (
        `${relative(REPO_ROOT, file)}: ${token}`
      ))
    ))

    expect(legacy).toEqual([])
  })

  it('imports global styles in layout-aware order', () => {
    const entry = readFileSync(join(STYLES_ROOT, 'index.ts'), 'utf8')
    const imports = [...entry.matchAll(/^import\s+'\.\/([^']+)'\s*$/gm)].flatMap(match => (
      match[1] ? [match[1]] : []
    ))

    expect(imports).toEqual(['index.css', 'layout.css', 'ios-theme.css'])
  })
})
