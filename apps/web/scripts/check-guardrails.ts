#!/usr/bin/env node
// 依赖与职责护栏 CLI。
//
// 阻断项边界见 docs/development/guardrails.md。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  analyzeDependencies,
  checkGlobalStyleScope,
  checkLayoutRegions,
  checkLayoutTestDetails,
  checkPageGuardrails,
  readSourceTree,
  readStyleTree,
  type GuardrailRule,
  type GuardrailViolation,
} from './guardrails.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const clientRoot = path.resolve(__dirname, '..')
const srcRoot = path.join(clientRoot, 'src')

function printViolations(violations: readonly GuardrailViolation[]): void {
  for (const violation of violations) {
    console.error(`[${violation.rule}] ${violation.file}`)
    console.error(`  ${violation.message}`)
  }
}

function printRuleSummary(violations: readonly GuardrailViolation[]): void {
  const rules: GuardrailRule[] = [
    'domain-cycle',
    'deep-import',
    'layer-direction',
    'task-execution-reverse',
    'page-transport',
    'page-storage',
    'page-polling',
    'layout-region',
    'global-style-scope',
    'layout-test-detail',
  ]
  for (const rule of rules) {
    const count = violations.filter(violation => violation.rule === rule).length
    console.log(`  ${rule.padEnd(22)} ${count}`)
  }
}

const sourceFiles = await readSourceTree(srcRoot)
const styleFiles = await readStyleTree(srcRoot)
const layoutTestFiles = sourceFiles.filter(file => file.path.endsWith('.layout.test.tsx'))
const dependencyAnalysis = analyzeDependencies(sourceFiles)
const violations = [
  ...dependencyAnalysis.violations,
  ...checkPageGuardrails(sourceFiles),
  ...checkLayoutRegions(sourceFiles),
  ...checkGlobalStyleScope(styleFiles),
  ...checkLayoutTestDetails(layoutTestFiles),
]

const featureDomains = new Set(
  dependencyAnalysis.edges.flatMap((edge) => {
    const [top, domain] = edge.from.split('/')
    return top === 'features' && domain ? [domain] : []
  }),
)

console.log(
  `依赖与职责护栏：扫描 ${sourceFiles.length} 个源文件、${dependencyAnalysis.edges.length} 条源码内 import、`
  + `${styleFiles.length} 个样式文件与 ${layoutTestFiles.length} 个布局测试；`
  + `${featureDomains.size} 个功能域，${dependencyAnalysis.cycles.length} 个依赖环。`,
)
if (violations.length > 0) {
  console.error(`发现 ${violations.length} 项违规：`)
  printViolations(violations)
  console.error('')
  printRuleSummary(violations)
  console.error('')
  console.error('规则说明见 docs/development/guardrails.md。')
  process.exit(1)
}
console.log('依赖与职责检查通过（域环、深路径、分层方向、task-execution 反向依赖、页面裸副作用、壳层锚点、全局样式作用域、布局测试细节）。')
