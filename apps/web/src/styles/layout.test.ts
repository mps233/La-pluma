import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const STYLES_ROOT = fileURLToPath(new URL('.', import.meta.url))

const LAYOUT_TOKEN_DEFINITION_RE = /(--layout-[\w-]+)\s*:/g
const LAYOUT_TOKEN_REFERENCE_RE = /var\(\s*(--layout-[\w-]+)/g
const LEGACY_TOKEN_RE = new RegExp(`${'--la'}-${'pluma'}-` + '[\\w-]+', 'g')
const BOOT_STYLE_RE = /<style id="la-pluma-boot-style">([\s\S]*?)<\/style>/
const CUSTOM_PROPERTY_RE = /(--[\w-]+)\s*:\s*([^;]+);/g
const VAR_REFERENCE_RE = /var\(\s*(--[\w-]+)\s*\)/g

interface CustomPropertyDeclaration {
  token: string
  value: string
  location: string
}

function customPropertyDeclarations(
  source: string,
  sourceLabel: string,
): CustomPropertyDeclaration[] {
  return [...source.matchAll(CUSTOM_PROPERTY_RE)].flatMap(match => {
    const token = match[1]
    const value = match[2]
    if (!token || !value || match.index === undefined) return []
    return [{
      token,
      value: value.replace(/\s+/g, ' ').trim(),
      location: `${sourceLabel}:${source.slice(0, match.index).split('\n').length}`,
    }]
  })
}

function groupCustomProperties(
  declarations: CustomPropertyDeclaration[],
): Map<string, CustomPropertyDeclaration[]> {
  const grouped = new Map<string, CustomPropertyDeclaration[]>()
  for (const declaration of declarations) {
    const entries = grouped.get(declaration.token) ?? []
    entries.push(declaration)
    grouped.set(declaration.token, entries)
  }
  return grouped
}

function resolveCustomProperty(
  name: string,
  grouped: Map<string, CustomPropertyDeclaration[]>,
  depth = 0,
): string {
  if (depth > 16) throw new Error(`token reference depth exceeded: ${name}`)

  const declarations = grouped.get(name)
  if (!declarations || declarations.length === 0) {
    throw new Error(`missing token declaration: ${name}`)
  }
  if (declarations.length > 1) {
    throw new Error(
      `ambiguous token declaration: ${name} 出现 ${declarations.length} 次（${declarations.map(({ location }) => location).join('、')}）`,
    )
  }

  const [declaration] = declarations
  if (!declaration) throw new Error(`missing token declaration: ${name}`)

  return declaration.value.replace(
    VAR_REFERENCE_RE,
    (_match, reference: string) => resolveCustomProperty(reference, grouped, depth + 1),
  ).replace(/\s+/g, ' ').trim()
}

function customPropertyValues(
  name: string,
  grouped: Map<string, CustomPropertyDeclaration[]>,
): string[] {
  return (grouped.get(name) ?? []).map(({ value }) => value)
}

function readLayoutTokens(): Map<string, CustomPropertyDeclaration[]> {
  return groupCustomProperties(customPropertyDeclarations(
    readFileSync(join(STYLES_ROOT, 'layout.css'), 'utf8'),
    'layout.css',
  ))
}

function readBootTokens(): Map<string, CustomPropertyDeclaration[]> {
  const html = readFileSync(join(REPO_ROOT, 'apps', 'web', 'index.html'), 'utf8')
  const bootStyle = BOOT_STYLE_RE.exec(html)?.[1]
  if (!bootStyle) throw new Error('index.html 缺少启动壳样式块')
  return groupCustomProperties(customPropertyDeclarations(bootStyle, 'index.html 启动壳样式'))
}

const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.md', '.mjs', '.ts', '.tsx'])
const PRODUCTION_SOURCE_EXTENSIONS = new Set(['.css', '.ts', '.tsx'])
const TEST_SOURCE_RE = /\.(?:test|spec)\.(?:ts|tsx)$/
const EXAMPLES_SOURCE_RE = /\.pw\.ts$/
const RETIRED_Z_INDEX_RE = new RegExp(String.raw`z-index:\s*2000\b|\bz-${'9999'}\b`)
const RAW_LAYER_CLASS_RE = new RegExp(String.raw`\bz-(?:50|60|${'9999'})\b`)

const Z_LAYER_TOKENS = [
  ['--layout-z-content', '0'],
  ['--layout-z-sticky', '10'],
  ['--layout-z-chrome', '20'],
  ['--layout-z-tabbar', '30'],
  ['--layout-z-raised', '40'],
  ['--layout-z-portal', '50'],
  ['--layout-z-toast', '60'],
  ['--layout-z-immersive', '70'],
] as const

const WEB_SRC_ROOT = join(REPO_ROOT, 'apps', 'web', 'src')

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

function collectProductionSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    if (TEST_SOURCE_RE.test(entry) || EXAMPLES_SOURCE_RE.test(entry)) return []
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return collectProductionSourceFiles(path)
    return PRODUCTION_SOURCE_EXTENSIONS.has(extname(entry)) ? [path] : []
  })
}

function cssRuleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
}

function occurrenceCount(source: string, needle: string): number {
  return source.split(needle).length - 1
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

  it('keeps the boot shell geometry in sync with layout tokens', () => {
    const layoutTokens = readLayoutTokens()
    const bootTokens = readBootTokens()

    const checks = [
      {
        label: '启动壳 navbar 高度',
        bootToken: '--boot-navbar-height',
        layoutToken: '--layout-navbar-height',
      },
      {
        label: '启动壳底部留白',
        bootToken: '--boot-bottom-clearance',
        layoutToken: '--layout-tabbar-bottom-clearance',
      },
    ]

    const mismatches = checks.flatMap(({ label, bootToken, layoutToken }) => {
      const bootValue = resolveCustomProperty(bootToken, bootTokens)
      const layoutValue = resolveCustomProperty(layoutToken, layoutTokens)
      if (bootValue === layoutValue) return []
      return [`${label}: index.html 的 ${bootToken} 为 ${bootValue}，layout.css 的 ${layoutToken} 为 ${layoutValue}`]
    })

    expect(mismatches).toEqual([])
  })

  it('keeps viewport height branches in sync between the boot shell and layout tokens', () => {
    const bootValues = customPropertyValues('--boot-viewport-height', readBootTokens())
    expect(bootValues.length).toBeGreaterThan(0)
    expect(customPropertyValues('--layout-viewport-height', readLayoutTokens())).toEqual(bootValues)
  })

  it('rejects duplicate declarations instead of masking them with a later context', () => {
    const navbar = groupCustomProperties([
      ...customPropertyDeclarations(
        ':root { --fixture-navbar-height: 4rem; }',
        'fixture.css',
      ),
      ...customPropertyDeclarations(
        '@media (width < 640px) { :root { --fixture-navbar-height: 3rem; } }',
        'fixture.css',
      ),
    ])
    expect(() => resolveCustomProperty('--fixture-navbar-height', navbar))
      .toThrow(/ambiguous token declaration: --fixture-navbar-height 出现 2 次/)

    const dependency = groupCustomProperties([
      ...customPropertyDeclarations(
        ':root { --fixture-outer: var(--fixture-inner); --fixture-inner: 1rem; }',
        'fixture.css',
      ),
      ...customPropertyDeclarations(
        '@media (width < 640px) { :root { --fixture-inner: 2rem; } }',
        'fixture.css',
      ),
    ])
    expect(() => resolveCustomProperty('--fixture-outer', dependency))
      .toThrow(/ambiguous token declaration: --fixture-inner 出现 2 次/)
  })
})

describe('z-index layer scale', () => {
  it('defines the finite scale with strictly increasing values', () => {
    const tokens = readLayoutTokens()
    const values = Z_LAYER_TOKENS.map(([token]) => resolveCustomProperty(token, tokens))

    expect(values).toEqual(Z_LAYER_TOKENS.map(([, value]) => value))
    const numeric = values.map(Number)
    expect(numeric.every((value, index) => index === 0 || value > numeric[index - 1]!)).toBe(true)
  })

  it('maps shell regions to their scale tokens', () => {
    const layoutCss = readFileSync(join(STYLES_ROOT, 'layout.css'), 'utf8')
    const expected = [
      ['.la-pluma-navbar', '--layout-z-chrome'],
      ['.la-pluma-page-body', '--layout-z-content'],
      ['.la-pluma-skip-link', '--layout-z-raised'],
      ['.la-pluma-tabbar', '--layout-z-tabbar'],
    ] as const

    for (const [selector, token] of expected) {
      expect(cssRuleBody(layoutCss, selector)).toContain(`z-index: var(${token});`)
    }
  })

  it('keeps retired high z-index values out of production source', () => {
    const offenders = collectProductionSourceFiles(WEB_SRC_ROOT).flatMap(file => {
      const source = readFileSync(file, 'utf8')
      return RETIRED_Z_INDEX_RE.test(source) ? [relative(REPO_ROOT, file)] : []
    })

    expect(offenders).toEqual([])
  })

  it('uses scale tokens for application floating layers', () => {
    const expectations = [
      ['app/layout/PWAInstallPrompt.tsx', '--layout-z-raised', 3],
      ['app/layout/ThemeToggle.tsx', '--layout-z-portal', 1],
      ['features/combat/components/CombatCopilotDetailLayer.tsx', '--layout-z-portal', 3],
      ['features/device-mirror/components/ScrcpyDeviceView.tsx', '--layout-z-immersive', 1],
    ] as const

    for (const [file, token, count] of expectations) {
      const source = readFileSync(join(WEB_SRC_ROOT, file), 'utf8')
      expect(occurrenceCount(source, `z-(${token})`), file).toBe(count)
      expect(RAW_LAYER_CLASS_RE.test(source), file).toBe(false)
    }
  })

  it('wires portal backdrops and toasts to the scale', () => {
    const indexCss = readFileSync(join(STYLES_ROOT, 'index.css'), 'utf8')

    expect(indexCss).toMatch(
      /\[data-base-ui-portal\][^{]*\{[^}]*z-index:\s*var\(--layout-z-portal\)\s*!important/,
    )
    expect(indexCss).toMatch(
      /\[data-sonner-toaster\]\s*\{[^}]*z-index:\s*var\(--layout-z-toast\)\s*!important/,
    )
  })
})
