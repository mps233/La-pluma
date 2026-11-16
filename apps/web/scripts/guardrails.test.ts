import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  analyzeDependencies,
  buildImportEdges,
  checkGlobalStyleScope,
  checkLayoutRegions,
  checkLayoutTestDetails,
  checkPageGuardrails,
  collectImportSpecifiers,
  readSourceTree,
  readStyleTree,
  resolveImport,
  type SourceFile,
} from './guardrails.ts'

const files = (...entries: [path: string, source?: string][]): SourceFile[] =>
  entries.map(([path, source = '']) => ({ path, source }))

describe('import extraction and resolution', () => {
  it('collects static, re-export and dynamic imports but ignores comments and strings', () => {
    const source = `
      import { a } from '@/features/a'
      export { b } from './b'
      import './styles.css'
      // import { ignored } from '@/features/ignored'
      const text = "import x from '@/features/not-an-import'"
      const load = () => import('@/features/lazy')
    `

    expect(collectImportSpecifiers(source, 'features/demo/model/x.ts')).toEqual([
      '@/features/a',
      './b',
      './styles.css',
      '@/features/lazy',
    ])
  })

  it('resolves aliases, relative paths and directory indexes against known sources', () => {
    const known = new Set([
      'features/a/index.ts',
      'features/a/model/x.ts',
      'features/b/index.ts',
      'pages/b/Page.tsx',
      'shared/api/index.ts',
    ])

    expect(resolveImport('@/features/b', 'features/a/index.ts', known)).toBe('features/b/index.ts')
    expect(resolveImport('@/features/a/model/x', 'features/b/index.ts', known)).toBe('features/a/model/x.ts')
    expect(resolveImport('../../pages/b/Page', 'features/b/index.ts', known)).toBe('pages/b/Page.tsx')
    expect(resolveImport('@/shared/api', 'features/a/index.ts', known)).toBe('shared/api/index.ts')
    expect(resolveImport('react', 'features/a/index.ts', known)).toBeNull()
    expect(resolveImport('./missing', 'features/a/index.ts', known)).toBeNull()
  })

  it('builds edges only for source-to-source imports', () => {
    const edges = buildImportEdges(files(
      ['features/a/index.ts', "import { b } from '@/features/b'\nimport './styles/a.css'\n"],
      ['features/b/index.ts', 'export const b = 1\n'],
    ))

    expect(edges).toEqual([{ from: 'features/a/index.ts', to: 'features/b/index.ts', specifier: '@/features/b' }])
  })
})

describe('dependency guardrails', () => {
  it('flags a feature importing another feature by a deep alias path', () => {
    const analysis = analyzeDependencies(files(
      ['features/a/index.ts', "import { b } from '@/features/b/model/b'\n"],
      ['features/b/index.ts', 'export const b = 1\n'],
      ['features/b/model/b.ts', 'export const b = 1\n'],
    ))

    expect(analysis.violations.some(violation =>
      violation.rule === 'deep-import'
      && violation.file === 'features/a/index.ts'
      && violation.message.includes('@/features/b'),
    )).toBe(true)
  })

  it('flags explicit index paths and trailing slashes as public-surface bypass', () => {
    const analysis = analyzeDependencies(files(
      ['features/a/index.ts', "export { b } from '@/features/b/index'\nexport { b as c } from '@/features/b/'\n"],
      ['features/b/index.ts', 'export const b = 1\n'],
    ))

    expect(analysis.violations.map(violation => violation.rule)).toEqual(['deep-import', 'deep-import'])
  })

  it('flags a cross-domain relative import even when it lands on the public index', () => {
    const analysis = analyzeDependencies(files(
      ['features/a/index.ts', "export { b } from '../b'\n"],
      ['features/b/index.ts', 'export const b = 1\n'],
    ))

    expect(analysis.violations).toEqual([
      expect.objectContaining({
        rule: 'deep-import',
        file: 'features/a/index.ts',
      }),
    ])
  })

  it('flags app deep imports, shared reverse dependencies and feature-to-app imports', () => {
    const analysis = analyzeDependencies(files(
      ['app/router/pages.ts', "import Workspace from '../../features/a/components/Workspace'\nimport Page from '@/pages/a/Page'\n"],
      ['features/a/index.ts', 'export { default as Workspace } from "./components/Workspace"\n'],
      ['features/a/components/Workspace.tsx', 'export default function Workspace() { return null }\n'],
      ['pages/a/Page.tsx', 'export default function Page() { return null }\n'],
      ['shared/utils/leak.ts', "import { a } from '@/features/a'\n"],
      ['features/a/model/reverse.ts', "import App from '@/app/App'\n"],
      ['app/App.tsx', 'export default function App() { return null }\n'],
    ))

    expect(analysis.violations.map(violation => violation.rule)).toEqual([
      'deep-import',
      'layer-direction',
      'layer-direction',
    ])
  })

  it('flags feature and task-execution imports of the root entry', () => {
    const analysis = analyzeDependencies(files(
      ['features/a/index.ts', "import { boot } from '@/main'\nexport const a = boot\n"],
      ['features/task-execution/index.ts', "import { boot } from '@/main'\nexport const t = boot\n"],
      ['main.tsx', 'export const boot = 1\n'],
    ))

    expect(analysis.violations).toEqual([
      expect.objectContaining({ rule: 'layer-direction', file: 'features/a/index.ts' }),
      expect.objectContaining({ rule: 'layer-direction', file: 'features/task-execution/index.ts' }),
    ])
  })

  it('keeps task-execution free of reverse dependencies on page domains', () => {
    const analysis = analyzeDependencies(files(
      ['features/task-execution/index.ts', "import { useStatusStore } from '@/features/runtime-status'\n"],
      ['features/runtime-status/index.ts', 'export const useStatusStore = () => null\n'],
    ))

    expect(analysis.violations).toEqual([
      expect.objectContaining({
        rule: 'task-execution-reverse',
        file: 'features/task-execution/index.ts',
      }),
    ])
  })

  it('flags a real two-domain dependency cycle with a readable path', () => {
    const analysis = analyzeDependencies(files(
      ['features/a/index.ts', "import { b } from '@/features/b'\nexport const a = b\n"],
      ['features/b/index.ts', "import { a } from '@/features/a'\nexport const b = a\n"],
    ))

    expect(analysis.cycles).toEqual([['a', 'b', 'a']])
    expect(analysis.violations).toEqual([
      expect.objectContaining({ rule: 'domain-cycle' }),
    ])
    expect(analysis.violations[0]?.message).toContain('a → b → a')
  })

  it('allows cross-domain public imports, same-domain relative imports and shared imports', () => {
    const analysis = analyzeDependencies(files(
      ['features/a/index.ts', "import { b } from '@/features/b'\nimport { api } from '@/shared/api'\nexport { b, api }\n"],
      ['features/a/components/Workspace.tsx', "import { helper } from '../model/helper'\nimport { b } from '@/features/b'\nexport const value = helper(b)\n"],
      ['features/a/model/helper.ts', 'export const helper = (value: unknown) => value\n'],
      ['features/b/index.ts', 'export const b = 1\n'],
      ['shared/api/index.ts', 'export const api = 1\n'],
    ))

    expect(analysis.violations).toEqual([])
    expect(analysis.cycles).toEqual([])
  })
})

describe('page responsibility guardrails', () => {
  it('flags a page that imports transport or Query infrastructure directly', () => {
    const violations = checkPageGuardrails(files(
      ['pages/a/Page.tsx', [
        "import { fetchWithAuth } from '@/shared/api'",
        "import { getQueryClient } from '@/shared/query'",
        "import { useQuery } from '@tanstack/react-query'",
        'export default function Page() { return null }',
      ].join('\n')],
      ['shared/api/index.ts', 'export const fetchWithAuth = () => null\n'],
      ['shared/query/index.ts', 'export const getQueryClient = () => null\n'],
    ))

    expect(violations.map(violation => violation.rule)).toEqual([
      'page-transport',
      'page-transport',
      'page-transport',
    ])
  })

  it('flags bare transport, storage and polling globals in a page', () => {
    const violations = checkPageGuardrails(files(
      ['pages/a/Page.tsx', [
        'export default function Page() {',
        "  fetch('/api/agent/tasks/status')",
        "  new WebSocket('/webrtc-signaling/socket')",
        "  window.localStorage.getItem('draft')",
        '  setInterval(() => fetch(\'/api/agent/tasks/status\'), 1000)',
        '  return null',
        '}',
      ].join('\n')],
    ))

    expect(violations.map(violation => violation.rule)).toEqual([
      'page-transport',
      'page-transport',
      'page-storage',
      'page-polling',
      'page-transport',
    ])
  })

  it('flags a page importing a domain endpoint through the feature public surface', () => {
    const violations = checkPageGuardrails(files(
      ['features/automation/index.ts', [
        "export { executeScheduleNow } from './api'",
        "export { useAutomationThing } from './hooks/useAutomationThing'",
      ].join('\n')],
      ['features/automation/api/index.ts', 'export const executeScheduleNow = () => null\n'],
      ['features/automation/hooks/useAutomationThing.ts', 'export const useAutomationThing = () => null\n'],
      ['pages/a/Page.tsx', [
        "import { executeScheduleNow, useAutomationThing } from '@/features/automation'",
        'export default function Page() {',
        '  useAutomationThing()',
        '  executeScheduleNow()',
        '  return null',
        '}',
      ].join('\n')],
    ))

    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ rule: 'page-transport' })
    expect(violations[0]?.message).toContain('executeScheduleNow')
  })

  it('detects computed global access and ignores local binding names', () => {
    const computed = checkPageGuardrails(files(
      ['pages/a/Page.tsx', [
        "window['fetch']('/api/agent/tasks/status')",
        "globalThis['setInterval'](() => {}, 1000)",
        "window[`localStorage`].getItem('draft')",
        'export default function Page() { return null }',
      ].join('\n')],
    ))
    expect(computed.map(violation => violation.rule)).toEqual([
      'page-transport',
      'page-polling',
      'page-storage',
    ])

    const shadowed = checkPageGuardrails(files(
      ['pages/a/Page.tsx', [
        'const { fetch, localStorage: storage } = useProps()',
        'function setInterval() {}',
        'type fetch = () => void',
        'interface localStorage {}',
        'enum setInterval { A }',
        'function generic<fetch>() { return null }',
        'type Props = { fetch: string; localStorage: string }',
        'export default function Page() { return null }',
      ].join('\n')],
    ))
    expect(shadowed).toEqual([])
  })

  it('detects global access through window proxies and destructuring', () => {
    const violations = checkPageGuardrails(files(
      ['pages/a/Page.tsx', [
        'const { fetch: request } = window',
        "const poll = window.top['setInterval']",
        ";(window.parent as any).localStorage.getItem('draft')",
        'export default function Page() { request(); poll(() => {}, 1); return null }',
      ].join('\n')],
    ))

    expect(violations.map(violation => violation.rule)).toEqual([
      'page-transport',
      'page-polling',
      'page-storage',
    ])
  })

  it('flags endpoints forwarded through an aliased local re-export', () => {
    const violations = checkPageGuardrails(files(
      ['features/a/index.ts', [
        "import { executeScheduleNow as run } from './api'",
        'export { run as executeScheduleNow }',
      ].join('\n')],
      ['features/a/api/index.ts', 'export const executeScheduleNow = () => null\n'],
      ['pages/a/Page.tsx', [
        "import { executeScheduleNow } from '@/features/a'",
        'executeScheduleNow()',
      ].join('\n')],
    ))

    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ rule: 'page-transport' })
    expect(violations[0]?.message).toContain('executeScheduleNow')
  })

  it('does not flag type-only imports from transport or query modules', () => {
    const violations = checkPageGuardrails(files(
      ['pages/a/Page.tsx', [
        "import type { ApiResponse } from '@/shared/api'",
        "import type { QueryClient } from '@tanstack/react-query'",
        "import { type AutomationActivityPayload } from '@/features/automation'",
        'export type { ApiResponse, QueryClient, AutomationActivityPayload }',
        'export default function Page() { return null }',
      ].join('\n')],
      ['shared/api/index.ts', 'export type ApiResponse = { ok: boolean }\n'],
      ['features/automation/index.ts', 'export type { AutomationActivityPayload } from "./types"\n'],
    ))

    expect(violations).toEqual([])
  })
})

const layoutRegionSource: Record<string, string> = {
  'app/layout/Layout.tsx': '<main data-region="scroll"><div data-region="page-content" /></main>',
  'app/layout/AppNavbar.tsx': '<header data-region="navbar"><div data-region="page-header"><h1 data-region="page-title" /></div></header>',
  'app/layout/AppSidebar.tsx': '<aside data-region="sidebar"><div data-region="sidebar-brand" /></aside>',
  'app/layout/AppTabbar.tsx': '<footer data-region="tabbar" />',
  'shared/components/PageShell.tsx': '<div data-region="page" data-page-kind={pageKind} data-page-layout={layout} data-page-surface={surface} />',
}

const layoutRegionFiles = (overrides: Record<string, string> = {}): SourceFile[] =>
  Object.entries(layoutRegionSource).map(([path, source]) => ({
    path,
    source: overrides[path] ?? source,
  }))

const globalStyleFilePaths = ['styles/index.css', 'styles/layout.css', 'styles/ios-theme.css']

const globalStyleFiles = (overrides: Record<string, string> = {}): SourceFile[] =>
  globalStyleFilePaths.map(path => ({
    path,
    source: overrides[path] ?? ':root { --radius: 0.5rem; }',
  }))

const layoutTestFiles = (source: string): SourceFile[] => [{
  path: 'pages/a/Page.layout.test.tsx',
  source,
}]

describe('layout region guardrails', () => {
  it('accepts the declared shell anchors', () => {
    expect(checkLayoutRegions(layoutRegionFiles())).toEqual([])
  })

  it('flags a missing shell anchor with the file and anchor name', () => {
    const violations = checkLayoutRegions(layoutRegionFiles({
      'app/layout/AppTabbar.tsx': '<footer className="la-pluma-tabbar" />',
    }))

    expect(violations).toEqual([
      expect.objectContaining({
        rule: 'layout-region',
        file: 'app/layout/AppTabbar.tsx',
      }),
    ])
    expect(violations[0]?.message).toContain('data-region="tabbar"')
  })

  it('flags a missing layout file instead of skipping it', () => {
    const violations = checkLayoutRegions(
      layoutRegionFiles().filter(file => file.path !== 'shared/components/PageShell.tsx'),
    )

    expect(violations).toEqual([
      expect.objectContaining({
        rule: 'layout-region',
        file: 'shared/components/PageShell.tsx',
      }),
    ])
    expect(violations[0]?.message).toContain('shared/components/PageShell.tsx')
  })
})

describe('global style scope guardrails', () => {
  it('ignores selector-like text in declarations and comments', () => {
    const violations = checkGlobalStyleScope(globalStyleFiles({
      'styles/index.css': [
        ':root { --automation-label: "automation-"; }',
        '/* .automation-card { color: red } [data-page-kind="x"] { color: red } */',
        '@theme { --radius-lg: var(--radius); }',
      ].join('\n'),
    }))

    expect(violations).toEqual([])
  })

  it('flags selectors after a top-level at-rule statement', () => {
    const violations = checkGlobalStyleScope(globalStyleFiles({
      'styles/index.css': [
        '@import "theme.css";',
        '.automation-evil { color: red; }',
      ].join('\n'),
    }))

    expect(violations).toHaveLength(1)
    expect(violations[0]?.message).toContain('第 2 行')
    expect(violations[0]?.message).toContain('.automation-evil')
  })

  it('flags page and domain selectors with the file and line number', () => {
    const violations = checkGlobalStyleScope(globalStyleFiles({
      'styles/layout.css': [
        ':root { --x: 1; }',
        '.automation-workspace { color: red; }',
        '',
        '[data-page-kind="automation"] { color: red; }',
      ].join('\n'),
    }))

    expect(violations).toHaveLength(2)
    expect(violations).toEqual([
      expect.objectContaining({
        rule: 'global-style-scope',
        file: 'styles/layout.css',
      }),
      expect.objectContaining({
        rule: 'global-style-scope',
        file: 'styles/layout.css',
      }),
    ])
    expect(violations[0]?.message).toContain('第 2 行')
    expect(violations[0]?.message).toContain('.automation-workspace')
    expect(violations[1]?.message).toContain('第 4 行')
    expect(violations[1]?.message).toContain('data-page-kind')
  })

  it('flags missing global style files instead of skipping them', () => {
    const violations = checkGlobalStyleScope(
      globalStyleFiles().filter(file => file.path !== 'styles/ios-theme.css'),
    )

    expect(violations).toEqual([
      expect.objectContaining({
        rule: 'global-style-scope',
        file: 'styles/ios-theme.css',
      }),
    ])
    expect(violations[0]?.message).toContain('ios-theme.css')
  })
})

describe('layout test detail guardrails', () => {
  it('allows prototype stubs and behavioural assertions', () => {
    const violations = checkLayoutTestDetails(layoutTestFiles([
      "// expect(element).toHaveClass('ignored')",
      "it('stubs scrolling', () => {",
      "  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: vi.fn() })",
      "  expect(element.getAttribute('aria-label')).toBe('inspect')",
      "  expect(document.body.querySelector('[role=\"dialog\"]')).not.toBeNull()",
      "  expect(container.querySelectorAll('[data-region=\"page\"]')).toHaveLength(1)",
      '})',
    ].join('\n')))

    expect(violations).toEqual([])
  })

  it('flags class, style, alignment and scroll details with line numbers', () => {
    const violations = checkLayoutTestDetails(layoutTestFiles([
      "expect(element).toHaveClass('min-h-11')",
      "expect(element.classList.contains('x')).toBe(true)",
      "expect(element.style.width).toBe('10px')",
      "expect(container.querySelector('[data-align=\"start\"]')).not.toBeNull()",
      'expect(handle.nextElementSibling).not.toBeNull()',
      "expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })",
      "expect(element).toHaveStyle({ display: 'none' })",
      "expect(handler).toHaveBeenLastCalledWith({ behavior: 'smooth', block: 'end' })",
      "expect(container.querySelector('.min-h-11')).not.toBeNull()",
      "expect(container.querySelectorAll('.sr-only')).toHaveLength(1)",
    ].join('\n')))

    expect(violations).toHaveLength(10)
    expect(violations.every(violation => violation.rule === 'layout-test-detail')).toBe(true)
    const messages = violations.map(violation => violation.message).join('\n')
    for (const detail of [
      'toHaveClass',
      'classList',
      '.style.width',
      'data-align',
      'nextElementSibling',
      'toHaveBeenCalledWith',
      'toHaveStyle',
      'toHaveBeenLastCalledWith',
      'querySelector 的类选择器',
      'querySelectorAll 的类选择器',
    ]) {
      expect(messages).toContain(detail)
    }
    expect(violations[0]?.message).toContain('第 1 行')
    expect(violations[9]?.message).toContain('第 10 行')
  })

  it('fails closed when no layout test files are found', () => {
    const violations = checkLayoutTestDetails([])

    expect(violations).toEqual([
      expect.objectContaining({ rule: 'layout-test-detail' }),
    ])
    expect(violations[0]?.message).toContain('未找到布局测试文件')
  })
})

describe('current source tree', () => {
  const srcRoot = fileURLToPath(new URL('../src', import.meta.url))

  it('has no dependency, public-surface, page responsibility or layout governance violations', async () => {
    const sourceFiles = await readSourceTree(srcRoot)
    const styleFiles = await readStyleTree(srcRoot)
    const layoutTestSourceFiles = sourceFiles.filter(file => file.path.endsWith('.layout.test.tsx'))
    const dependencyAnalysis = analyzeDependencies(sourceFiles)

    expect(sourceFiles.length).toBeGreaterThan(0)
    expect(styleFiles.length).toBeGreaterThan(0)
    expect(layoutTestSourceFiles.length).toBeGreaterThan(0)
    expect(dependencyAnalysis.cycles).toEqual([])
    expect(dependencyAnalysis.violations).toEqual([])
    expect(checkPageGuardrails(sourceFiles)).toEqual([])
    expect(checkLayoutRegions(sourceFiles)).toEqual([])
    expect(checkGlobalStyleScope(styleFiles)).toEqual([])
    expect(checkLayoutTestDetails(layoutTestSourceFiles)).toEqual([])
    expect(
      dependencyAnalysis.violations.filter(violation => violation.rule === 'task-execution-reverse'),
    ).toEqual([])
  })
})
