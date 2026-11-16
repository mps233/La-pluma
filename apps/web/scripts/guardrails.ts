/**
 * 依赖与职责护栏的分析核心。
 *
 * 规则边界见 docs/development/guardrails.md。测试文件不参与运行时依赖分析，
 * 因为测试可以为了隔离而接触内部实现，不会进入生产包。
 */
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'

export interface SourceFile {
  path: string
  source: string
}

export interface ImportEdge {
  from: string
  to: string
  specifier: string
}

export interface ImportBinding {
  specifier: string
  imported: string
  localName: string
  typeOnly: boolean
}

export interface ImportReference {
  specifier: string
  typeOnly: boolean
}

export interface ReExport {
  exportedName: string
  localName?: string
  specifier: string | null
  typeOnly: boolean
}

export type GuardrailRule =
  | 'domain-cycle'
  | 'deep-import'
  | 'layer-direction'
  | 'task-execution-reverse'
  | 'page-transport'
  | 'page-storage'
  | 'page-polling'
  | 'layout-region'
  | 'global-style-scope'
  | 'layout-test-detail'

export interface GuardrailViolation {
  rule: GuardrailRule
  file: string
  message: string
}

export interface DependencyAnalysis {
  edges: ImportEdge[]
  cycles: string[][]
  violations: GuardrailViolation[]
}

const TEST_FILE_PATTERN = /\.(?:test|spec)\.(?:ts|tsx)$/
const PAGE_FILE_PATTERN = /^pages\/[^/]+\/[^/]+\.(?:ts|tsx)$/

const TRANSPORT_GLOBALS = new Set(['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest'])
const STORAGE_GLOBALS = new Set(['localStorage', 'sessionStorage', 'indexedDB'])
const POLLING_GLOBALS = new Set(['setInterval'])

export function isTestFile(filePath: string): boolean {
  return TEST_FILE_PATTERN.test(filePath)
}

export function isPageFile(filePath: string): boolean {
  return PAGE_FILE_PATTERN.test(filePath) && !isTestFile(filePath)
}

function scriptKindOf(filePath: string): ts.ScriptKind {
  return filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
}

function parseSourceFile(file: SourceFile): ts.SourceFile {
  return ts.createSourceFile(
    file.path,
    file.source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(file.path),
  )
}

function isTypeOnlyImportDeclaration(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause
  if (!clause) return false
  if (clause.isTypeOnly) return true
  if (clause.name) return false
  const namedBindings = clause.namedBindings
  if (!namedBindings || ts.isNamespaceImport(namedBindings)) return false
  return namedBindings.elements.length > 0
    && namedBindings.elements.every(element => element.isTypeOnly)
}

function isTypeOnlyExportDeclaration(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true
  const clause = node.exportClause
  return !!clause
    && ts.isNamedExports(clause)
    && clause.elements.length > 0
    && clause.elements.every(element => element.isTypeOnly)
}

export function collectImportReferences(source: string, filePath = 'sample.tsx'): ImportReference[] {
  const sourceFile = parseSourceFile({ path: filePath, source })
  const references: ImportReference[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      references.push({
        specifier: node.moduleSpecifier.text,
        typeOnly: isTypeOnlyImportDeclaration(node),
      })
    }

    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      references.push({
        specifier: node.moduleSpecifier.text,
        typeOnly: isTypeOnlyExportDeclaration(node),
      })
    }

    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [firstArgument] = node.arguments
      if (firstArgument && ts.isStringLiteralLike(firstArgument)) {
        references.push({ specifier: firstArgument.text, typeOnly: false })
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return references
}

export function collectImportSpecifiers(source: string, filePath = 'sample.tsx'): string[] {
  return collectImportReferences(source, filePath).map(reference => reference.specifier)
}

export function collectImportBindings(source: string, filePath = 'sample.tsx'): ImportBinding[] {
  const sourceFile = parseSourceFile({ path: filePath, source })
  const bindings: ImportBinding[] = []

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) {
      continue
    }

    const clause = statement.importClause
    if (!clause) continue
    const specifier = statement.moduleSpecifier.text
    const declarationTypeOnly = clause.isTypeOnly

    if (clause.name) {
      bindings.push({
        specifier,
        imported: 'default',
        localName: clause.name.text,
        typeOnly: declarationTypeOnly,
      })
    }

    const namedBindings = clause.namedBindings
    if (!namedBindings) continue

    if (ts.isNamespaceImport(namedBindings)) {
      bindings.push({
        specifier,
        imported: '*',
        localName: namedBindings.name.text,
        typeOnly: declarationTypeOnly,
      })
      continue
    }

    for (const element of namedBindings.elements) {
      bindings.push({
        specifier,
        imported: element.propertyName?.text ?? element.name.text,
        localName: element.name.text,
        typeOnly: declarationTypeOnly || element.isTypeOnly,
      })
    }
  }

  return bindings
}

export function collectReExports(source: string, filePath = 'sample.ts'): ReExport[] {
  const sourceFile = parseSourceFile({ path: filePath, source })
  const reExports: ReExport[] = []

  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement)) continue

    const clause = statement.exportClause
    if (statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text
      if (!clause) {
        reExports.push({ exportedName: '*', specifier, typeOnly: statement.isTypeOnly })
        continue
      }

      if (ts.isNamespaceExport(clause)) {
        reExports.push({
          exportedName: clause.name.text,
          specifier,
          typeOnly: statement.isTypeOnly,
        })
        continue
      }

      if (!ts.isNamedExports(clause)) continue
      for (const element of clause.elements) {
        reExports.push({
          exportedName: element.name.text,
          specifier,
          typeOnly: statement.isTypeOnly || element.isTypeOnly,
        })
      }
      continue
    }

    if (!clause || !ts.isNamedExports(clause)) continue
    for (const element of clause.elements) {
      reExports.push({
        exportedName: element.name.text,
        localName: element.propertyName?.text ?? element.name.text,
        specifier: null,
        typeOnly: statement.isTypeOnly || element.isTypeOnly,
      })
    }
  }

  return reExports
}

export function resolveImport(
  specifier: string,
  fromFile: string,
  knownFiles: ReadonlySet<string>,
): string | null {
  const cleaned = specifier.split(/[?#]/)[0] ?? specifier
  let base: string

  if (cleaned.startsWith('@/')) {
    base = path.posix.normalize(cleaned.slice(2)).replace(/\/+$/, '')
  } else if (cleaned.startsWith('.')) {
    base = path.posix
      .normalize(path.posix.join(path.posix.dirname(fromFile), cleaned))
      .replace(/\/+$/, '')
  } else {
    return null
  }

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]

  for (const candidate of candidates) {
    if (knownFiles.has(candidate)) return candidate
  }
  return null
}

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false
  return ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
}

function collectBindingNames(name: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(name)) {
    names.add(name.text)
    return
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) collectBindingNames(element.name, names)
  }
}

function collectModuleExportedNames(
  filePath: string,
  filesByPath: ReadonlyMap<string, SourceFile>,
  knownFiles: ReadonlySet<string>,
  seen: Set<string>,
): Set<string> {
  const names = new Set<string>()
  if (seen.has(filePath)) return names
  seen.add(filePath)

  const file = filesByPath.get(filePath)
  if (!file) return names
  const sourceFile = parseSourceFile(file)

  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement)) {
      names.add('default')
      continue
    }

    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        collectBindingNames(declaration.name, names)
      }
      continue
    }

    if (
      (ts.isFunctionDeclaration(statement)
        || ts.isClassDeclaration(statement)
        || ts.isEnumDeclaration(statement))
      && hasExportModifier(statement)
      && statement.name
    ) {
      names.add(statement.name.text)
      continue
    }

    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue

    if (!statement.exportClause) {
      if (statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier)) {
        const target = resolveImport(statement.moduleSpecifier.text, filePath, knownFiles)
        if (target) {
          for (const name of collectModuleExportedNames(target, filesByPath, knownFiles, seen)) {
            names.add(name)
          }
        }
      }
      continue
    }

    if (ts.isNamespaceExport(statement.exportClause)) {
      names.add(statement.exportClause.name.text)
      continue
    }

    if (!ts.isNamedExports(statement.exportClause)) continue
    for (const element of statement.exportClause.elements) {
      if (!element.isTypeOnly) names.add(element.name.text)
    }
  }

  return names
}

export function buildImportEdges(files: readonly SourceFile[]): ImportEdge[] {
  const knownFiles = new Set(files.map(file => file.path))
  const edges: ImportEdge[] = []

  for (const file of files) {
    for (const specifier of collectImportSpecifiers(file.source, file.path)) {
      const target = resolveImport(specifier, file.path, knownFiles)
      if (target && target !== file.path) {
        edges.push({ from: file.path, to: target, specifier })
      }
    }
  }

  return edges
}

function topLayerOf(filePath: string): 'app' | 'pages' | 'shared' | 'features' | 'root' {
  const top = filePath.split('/')[0]
  if (top === 'app' || top === 'pages' || top === 'shared' || top === 'features') return top
  return 'root'
}

function featureDomainOf(filePath: string): string | null {
  const [top, domain] = filePath.split('/')
  return top === 'features' && domain ? domain : null
}

function pageDomainOf(filePath: string): string | null {
  const match = /^pages\/([^/]+)\//.exec(filePath)
  return match?.[1] ?? null
}

function isFeatureIndex(filePath: string): { domain: string } | null {
  const match = /^features\/([^/]+)\/index\.tsx?$/.exec(filePath)
  return match?.[1] ? { domain: match[1] } : null
}

function cyclePathForComponent(
  graph: ReadonlyMap<string, ReadonlySet<string>>,
  component: ReadonlySet<string>,
): string[] {
  if (component.size === 1) {
    const [only] = component
    if (only && graph.get(only)?.has(only)) return [only, only]
    return [...component]
  }

  const start = [...component].sort()[0]
  if (!start) return [...component]

  const pathStack: string[] = []
  const onPath = new Set<string>()

  const visit = (node: string): string[] | null => {
    pathStack.push(node)
    onPath.add(node)

    for (const next of [...(graph.get(node) ?? [])].sort()) {
      if (!component.has(next)) continue
      if (next === start && pathStack.length > 1) {
        return [...pathStack, start]
      }
      if (onPath.has(next)) continue
      const found = visit(next)
      if (found) return found
    }

    pathStack.pop()
    onPath.delete(node)
    return null
  }

  return visit(start) ?? [...component].sort()
}

export function findDomainCycles(edges: readonly ImportEdge[]): string[][] {
  const graph = new Map<string, Set<string>>()

  for (const edge of edges) {
    const from = featureDomainOf(edge.from)
    const to = featureDomainOf(edge.to)
    if (!from || !to || from === to) continue
    let targets = graph.get(from)
    if (!targets) {
      targets = new Set()
      graph.set(from, targets)
    }
    targets.add(to)
  }

  const indices = new Map<string, number>()
  const lowLinks = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const components: Set<string>[] = []
  let nextIndex = 0

  const strongConnect = (node: string): void => {
    indices.set(node, nextIndex)
    lowLinks.set(node, nextIndex)
    nextIndex += 1
    stack.push(node)
    onStack.add(node)

    for (const target of [...(graph.get(node) ?? [])].sort()) {
      if (!indices.has(target)) {
        strongConnect(target)
        lowLinks.set(node, Math.min(lowLinks.get(node)!, lowLinks.get(target)!))
      } else if (onStack.has(target)) {
        lowLinks.set(node, Math.min(lowLinks.get(node)!, indices.get(target)!))
      }
    }

    if (lowLinks.get(node) === indices.get(node)) {
      const component = new Set<string>()
      let member = stack.pop()
      while (member !== undefined) {
        onStack.delete(member)
        component.add(member)
        if (member === node) break
        member = stack.pop()
      }
      components.push(component)
    }
  }

  for (const node of [...graph.keys()].sort()) {
    if (!indices.has(node)) strongConnect(node)
  }

  return components
    .filter((component) => {
      if (component.size > 1) return true
      const [only] = component
      return only !== undefined && graph.get(only)?.has(only) === true
    })
    .map(component => cyclePathForComponent(graph, component))
    .sort((a, b) => a.join('/').localeCompare(b.join('/')))
}

export function analyzeDependencies(files: readonly SourceFile[]): DependencyAnalysis {
  const productionFiles = files.filter(file => !isTestFile(file.path))
  const edges = buildImportEdges(productionFiles)
  const violations: GuardrailViolation[] = []

  for (const edge of edges) {
    const fromLayer = topLayerOf(edge.from)
    const toLayer = topLayerOf(edge.to)

    if (fromLayer === 'shared' && toLayer !== 'shared') {
      violations.push({
        rule: 'layer-direction',
        file: edge.from,
        message: `shared 不得依赖 ${toLayer}：${edge.specifier}`,
      })
      continue
    }

    if (fromLayer === 'features' && toLayer === 'app') {
      violations.push({
        rule: 'layer-direction',
        file: edge.from,
        message: `features 不得反向依赖 app：${edge.specifier}`,
      })
      continue
    }

    if (fromLayer === 'features' && toLayer === 'pages') {
      violations.push({
        rule: 'layer-direction',
        file: edge.from,
        message: `features 不得反向依赖 pages：${edge.specifier}`,
      })
      continue
    }

    if (fromLayer === 'pages' && toLayer === 'app') {
      violations.push({
        rule: 'layer-direction',
        file: edge.from,
        message: `pages 不得反向依赖 app：${edge.specifier}`,
      })
      continue
    }

    if (fromLayer === 'pages' && toLayer === 'root') {
      violations.push({
        rule: 'layer-direction',
        file: edge.from,
        message: `pages 不得依赖根入口模块：${edge.specifier}`,
      })
      continue
    }

    if (fromLayer === 'features' && toLayer === 'root') {
      violations.push({
        rule: 'layer-direction',
        file: edge.from,
        message: `features 不得依赖根入口模块：${edge.specifier}`,
      })
      continue
    }

    const fromDomain = featureDomainOf(edge.from)
    const toDomain = featureDomainOf(edge.to)

    if (fromDomain === 'task-execution' && toDomain && toDomain !== 'task-execution') {
      violations.push({
        rule: 'task-execution-reverse',
        file: edge.from,
        message: `task-execution 是非页面微域，只能依赖 shared，不得依赖 features/${toDomain}：${edge.specifier}`,
      })
    }

    if (toDomain) {
      const targetIsPublicEntry = isFeatureIndex(edge.to)?.domain === toDomain
      const usesRootAlias = edge.specifier === `@/features/${toDomain}`
      const isCrossDomain = fromDomain !== null && fromDomain !== toDomain
      const isOutsideFeature = fromLayer === 'app' || fromLayer === 'pages' || fromLayer === 'root'

      if ((isCrossDomain || isOutsideFeature) && (!targetIsPublicEntry || !usesRootAlias)) {
        violations.push({
          rule: 'deep-import',
          file: edge.from,
          message: `跨域必须经 @/features/${toDomain} 根入口，不得使用 ${edge.specifier}`,
        })
      } else if (fromDomain === toDomain && edge.specifier.startsWith('@/features/')) {
        violations.push({
          rule: 'deep-import',
          file: edge.from,
          message: `同一功能域内部请用相对路径，不得经 ${edge.specifier} 访问自身`,
        })
      }
    }
  }

  const cycles = findDomainCycles(edges)
  for (const cycle of cycles) {
    const cycleDomains = new Set(cycle)
    const closingEdge = edges.find(edge => {
      const from = featureDomainOf(edge.from)
      const to = featureDomainOf(edge.to)
      return from !== null && to !== null && cycleDomains.has(from) && cycleDomains.has(to)
    })
    violations.push({
      rule: 'domain-cycle',
      file: closingEdge?.from ?? `features/${cycle[0] ?? 'unknown'}`,
      message: `功能域依赖成环：${cycle.join(' → ')}`,
    })
  }

  return { edges, cycles, violations }
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function staticMemberName(node: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | null {
  if (ts.isPropertyAccessExpression(node)) {
    return ts.isIdentifier(node.name) ? node.name.text : null
  }
  if (!node.argumentExpression) return null
  const argument = unwrapExpression(node.argumentExpression)
  return ts.isStringLiteralLike(argument) ? argument.text : null
}

const GLOBAL_OBJECT_NAMES = new Set(['window', 'globalThis', 'self'])
const WINDOW_PROXY_PROPERTIES = new Set(['window', 'globalThis', 'self', 'top', 'parent', 'frames'])

function isDocumentObjectExpression(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression)
  if (ts.isIdentifier(unwrapped)) return unwrapped.text === 'document'
  if (ts.isPropertyAccessExpression(unwrapped) || ts.isElementAccessExpression(unwrapped)) {
    return staticMemberName(unwrapped) === 'document'
      && isGlobalObjectExpression(unwrapped.expression)
  }
  return false
}

function isDocumentDefaultView(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression)
  if (!ts.isPropertyAccessExpression(unwrapped) && !ts.isElementAccessExpression(unwrapped)) {
    return false
  }
  if (staticMemberName(unwrapped) !== 'defaultView') return false
  return isDocumentObjectExpression(unwrapped.expression)
}

function isGlobalObjectExpression(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression)
  if (isDocumentDefaultView(unwrapped)) return true
  if (ts.isIdentifier(unwrapped)) return GLOBAL_OBJECT_NAMES.has(unwrapped.text)
  if (ts.isPropertyAccessExpression(unwrapped) || ts.isElementAccessExpression(unwrapped)) {
    const member = staticMemberName(unwrapped)
    return member !== null
      && WINDOW_PROXY_PROPERTIES.has(member)
      && isGlobalObjectExpression(unwrapped.expression)
  }
  return false
}

function isPropertyName(node: ts.Identifier): boolean {
  const { parent } = node
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node)
    || (ts.isPropertyAssignment(parent) && parent.name === node)
    || (ts.isPropertySignature(parent) && parent.name === node)
    || (ts.isPropertyDeclaration(parent) && parent.name === node)
    || (ts.isMethodSignature(parent) && parent.name === node)
    || (ts.isMethodDeclaration(parent) && parent.name === node)
    || (ts.isGetAccessorDeclaration(parent) && parent.name === node)
    || (ts.isSetAccessorDeclaration(parent) && parent.name === node)
    || (ts.isQualifiedName(parent) && parent.right === node)
    || (ts.isJsxAttribute(parent) && parent.name === node)
  )
}

function isAssignmentPatternExpression(node: ts.Node): boolean {
  const { parent } = node

  if (ts.isBinaryExpression(parent)) {
    return parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.left === node
  }

  if (
    ts.isParenthesizedExpression(parent)
    || ts.isAsExpression(parent)
    || ts.isTypeAssertionExpression(parent)
    || ts.isNonNullExpression(parent)
    || ts.isSatisfiesExpression(parent)
  ) {
    return isAssignmentPatternExpression(parent)
  }

  if (ts.isPropertyAssignment(parent) && parent.initializer === node) {
    return isAssignmentPatternExpression(parent)
  }

  if (ts.isObjectLiteralExpression(parent) && parent.properties.some(property => property === node)) {
    return isAssignmentPatternExpression(parent)
  }

  if (ts.isArrayLiteralExpression(parent) && parent.elements.some(element => element === node)) {
    return isAssignmentPatternExpression(parent)
  }

  return false
}

function isAssignmentPatternShorthand(node: ts.Identifier): boolean {
  const property = node.parent
  return ts.isShorthandPropertyAssignment(property)
    && property.name === node
    && isAssignmentPatternExpression(property)
}

function isBindingName(node: ts.Identifier): boolean {
  const { parent } = node
  return (
    (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node))
    || (ts.isVariableDeclaration(parent) && parent.name === node)
    || (ts.isParameter(parent) && parent.name === node)
    || (ts.isFunctionDeclaration(parent) && parent.name === node)
    || (ts.isFunctionExpression(parent) && parent.name === node)
    || (ts.isClassDeclaration(parent) && parent.name === node)
    || (ts.isClassExpression(parent) && parent.name === node)
    || (ts.isTypeAliasDeclaration(parent) && parent.name === node)
    || (ts.isInterfaceDeclaration(parent) && parent.name === node)
    || (ts.isEnumDeclaration(parent) && parent.name === node)
    || (ts.isTypeParameterDeclaration(parent) && parent.name === node)
    || (ts.isImportClause(parent) && parent.name === node)
    || (ts.isImportSpecifier(parent) && (parent.name === node || parent.propertyName === node))
    || (ts.isNamespaceImport(parent) && parent.name === node)
    || (ts.isImportEqualsDeclaration(parent) && parent.name === node)
    || (ts.isExportSpecifier(parent) && (parent.name === node || parent.propertyName === node))
  )
}

function literalPropertyName(name: ts.PropertyName | undefined): string | null {
  if (!name) return null
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text
  if (ts.isComputedPropertyName(name)) {
    const expression = unwrapExpression(name.expression)
    return ts.isStringLiteralLike(expression) ? expression.text : null
  }
  return null
}

function bindingElementKey(node: ts.BindingElement): string | null {
  if (node.propertyName) return literalPropertyName(node.propertyName)
  return ts.isIdentifier(node.name) ? node.name.text : null
}

function assignmentPropertyKey(
  node: ts.PropertyAssignment | ts.ShorthandPropertyAssignment,
): string | null {
  if (ts.isShorthandPropertyAssignment(node)) return node.name.text
  return literalPropertyName(node.name)
}

function findDestructuringSource(
  node: ts.BindingElement | ts.PropertyAssignment | ts.ShorthandPropertyAssignment,
): ts.Expression | undefined {
  if (ts.isBindingElement(node)) {
    let current: ts.Node = node

    while (
      ts.isBindingElement(current)
      || ts.isObjectBindingPattern(current)
      || ts.isArrayBindingPattern(current)
    ) {
      if (ts.isBindingElement(current) && current.initializer) return current.initializer
      const { parent } = current
      if (ts.isVariableDeclaration(parent) && parent.name === current) return parent.initializer
      if (ts.isParameter(parent) && parent.name === current) return parent.initializer
      current = parent
    }

    return undefined
  }

  let current: ts.Node = node

  while (true) {
    const { parent } = current
    if (
      ts.isParenthesizedExpression(parent)
      || ts.isAsExpression(parent)
      || ts.isTypeAssertionExpression(parent)
      || ts.isNonNullExpression(parent)
      || ts.isSatisfiesExpression(parent)
    ) {
      current = parent
      continue
    }
    if (ts.isPropertyAssignment(parent) && parent.initializer === current) {
      current = parent
      continue
    }
    if (ts.isObjectLiteralExpression(parent) || ts.isArrayLiteralExpression(parent)) {
      current = parent
      continue
    }
    if (
      ts.isBinaryExpression(parent)
      && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && parent.left === current
    ) {
      return parent.right
    }
    return undefined
  }
}

function unwrappedIdentifierName(expression: ts.Expression | undefined): string | null {
  if (!expression) return null
  const unwrapped = unwrapExpression(expression)
  return ts.isIdentifier(unwrapped) ? unwrapped.text : null
}

function functionExpressionOf(
  expression: ts.Expression | undefined,
): ts.ArrowFunction | ts.FunctionExpression | null {
  if (!expression) return null
  const unwrapped = unwrapExpression(expression)
  return ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped) ? unwrapped : null
}

function collectPropertyUsage(root: ts.Node, identifierName: string): Set<string> {
  const names = new Set<string>()
  const tracked = new Set([identifierName])

  const isTrackedExpression = (expression: ts.Expression | undefined): boolean => {
    const name = unwrappedIdentifierName(expression)
    return name !== null && tracked.has(name)
  }

  const trackBinding = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) {
      tracked.add(name.text)
      return
    }
    if (ts.isObjectBindingPattern(name)) {
      for (const key of collectObjectBindingKeys(name)) names.add(key)
    }
  }

  let changed = true
  while (changed) {
    const trackedBefore = tracked.size
    const namesBefore = names.size

    const visit = (node: ts.Node): void => {
      if (
        (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
        && isTrackedExpression(node.expression)
      ) {
        const member = staticMemberName(node)
        if (member) names.add(member)
      }

      if (
        (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node))
        && node.initializer
        && isTrackedExpression(node.initializer)
      ) {
        trackBinding(node.name)
      }

      if (
        ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && isTrackedExpression(node.right)
      ) {
        const left = unwrapExpression(node.left)
        if (ts.isIdentifier(left)) {
          tracked.add(left.text)
        } else if (ts.isObjectLiteralExpression(left)) {
          for (const key of collectObjectLiteralKeys(left)) names.add(key)
        }
      }

      if (
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'then'
        && isTrackedExpression(node.expression.expression)
      ) {
        const callback = functionExpressionOf(node.arguments[0])
        if (callback) {
          for (const name of collectCallbackModuleUsage(callback)) names.add(name)
        }
      }

      ts.forEachChild(node, visit)
    }

    visit(root)
    changed = tracked.size !== trackedBefore || names.size !== namesBefore
  }

  return names
}

function collectObjectBindingKeys(pattern: ts.ObjectBindingPattern): Set<string> {
  const names = new Set<string>()

  const visit = (current: ts.ObjectBindingPattern | ts.ArrayBindingPattern): void => {
    for (const element of current.elements) {
      if (!ts.isBindingElement(element)) continue
      const key = bindingElementKey(element)
      if (key) names.add(key)
      if (ts.isObjectBindingPattern(element.name) || ts.isArrayBindingPattern(element.name)) {
        visit(element.name)
      }
    }
  }

  visit(pattern)
  return names
}

function collectObjectLiteralKeys(expression: ts.Expression): Set<string> {
  const names = new Set<string>()
  const unwrapped = unwrapExpression(expression)
  if (!ts.isObjectLiteralExpression(unwrapped)) return names

  for (const property of unwrapped.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      names.add(property.name.text)
      continue
    }
    if (!ts.isPropertyAssignment(property)) continue
    const key = assignmentPropertyKey(property)
    if (key) names.add(key)
    for (const name of collectObjectLiteralKeys(property.initializer)) names.add(name)
  }

  return names
}

function collectBindingUsage(name: ts.BindingName, root: ts.Node): Set<string> {
  if (ts.isIdentifier(name)) return collectPropertyUsage(root, name.text)
  if (ts.isObjectBindingPattern(name)) return collectObjectBindingKeys(name)
  return new Set()
}

function collectCallbackModuleUsage(callback: ts.ArrowFunction | ts.FunctionExpression): Set<string> {
  const [parameter] = callback.parameters
  if (!parameter) return new Set()
  return collectBindingUsage(parameter.name, callback.body)
}

function climbThroughExpressionWrappers(node: ts.Node): ts.Node {
  let current = node
  while (
    current.parent
    && (
      ts.isAwaitExpression(current.parent)
      || ts.isParenthesizedExpression(current.parent)
      || ts.isAsExpression(current.parent)
      || ts.isTypeAssertionExpression(current.parent)
      || ts.isNonNullExpression(current.parent)
      || ts.isSatisfiesExpression(current.parent)
    )
  ) {
    current = current.parent
  }
  return current
}

function collectDynamicImportUsedNames(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): Set<string> {
  const receiver = climbThroughExpressionWrappers(call)
  const { parent } = receiver

  if (
    ts.isPropertyAccessExpression(parent)
    && parent.expression === receiver
    && parent.name.text === 'then'
    && ts.isCallExpression(parent.parent)
  ) {
    const callback = functionExpressionOf(parent.parent.arguments[0])
    if (callback) {
      return collectCallbackModuleUsage(callback)
    }
  }

  if (
    (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent))
    && parent.expression === receiver
  ) {
    const member = staticMemberName(parent)
    return member ? new Set([member]) : new Set()
  }

  if (
    (ts.isVariableDeclaration(parent) || ts.isParameter(parent))
    && parent.initializer === receiver
  ) {
    return collectBindingUsage(parent.name, sourceFile)
  }

  if (
    ts.isBinaryExpression(parent)
    && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && parent.right === receiver
  ) {
    const left = unwrapExpression(parent.left)
    if (ts.isIdentifier(left)) return collectPropertyUsage(sourceFile, left.text)
    if (ts.isObjectLiteralExpression(left)) return collectObjectLiteralKeys(left)
  }

  return new Set()
}

interface DynamicImportUsage {
  specifier: string
  usedNames: Set<string>
}

function collectDynamicImportUsages(sourceFile: ts.SourceFile): DynamicImportUsage[] {
  const usages: DynamicImportUsage[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [specifierArgument] = node.arguments
      if (specifierArgument && ts.isStringLiteralLike(specifierArgument)) {
        usages.push({
          specifier: specifierArgument.text,
          usedNames: collectDynamicImportUsedNames(node, sourceFile),
        })
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return usages
}

function pageRuleForGlobal(name: string): GuardrailRule | null {
  if (TRANSPORT_GLOBALS.has(name)) return 'page-transport'
  if (STORAGE_GLOBALS.has(name)) return 'page-storage'
  if (POLLING_GLOBALS.has(name)) return 'page-polling'
  return null
}

function collectModuleValueNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>()

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause
      if (!clause || clause.isTypeOnly) continue
      if (clause.name) names.add(clause.name.text)
      const namedBindings = clause.namedBindings
      if (!namedBindings) continue
      if (ts.isNamespaceImport(namedBindings)) {
        names.add(namedBindings.name.text)
        continue
      }
      for (const element of namedBindings.elements) {
        if (!element.isTypeOnly) names.add(element.name.text)
      }
      continue
    }

    if (ts.isImportEqualsDeclaration(statement)) {
      names.add(statement.name.text)
      continue
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        collectBindingNames(declaration.name, names)
      }
      continue
    }

    if (
      (ts.isFunctionDeclaration(statement)
        || ts.isClassDeclaration(statement)
        || ts.isEnumDeclaration(statement)
        || ts.isModuleDeclaration(statement))
      && statement.name
    ) {
      names.add(statement.name.text)
    }
  }

  return names
}

function collectPageGlobalViolations(file: SourceFile, violations: GuardrailViolation[]): void {
  const sourceFile = parseSourceFile(file)
  const reported = new Set<string>()
  const moduleValueNames = collectModuleValueNames(sourceFile)

  const lineOf = (node: ts.Node): number =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1

  const report = (name: string, line: number): void => {
    const rule = pageRuleForGlobal(name)
    if (!rule) return
    // 同一个原语可能同时命中解构键与裸标识符（例如 `({ fetch } = window)`），
    // 同一行只报一次，避免同一处使用产生重复违规。
    const key = `${rule}:${line}:${name}`
    if (reported.has(key)) return
    reported.add(key)
    const reason = rule === 'page-transport'
      ? '页面不得直接使用传输原语'
      : rule === 'page-storage'
        ? '页面不得直接读写浏览器存储'
        : '页面不得直接启动轮询'
    violations.push({
      rule,
      file: file.path,
      message: `${reason}（${name}，第 ${line} 行）；请交给领域容器、hook 或领域所有者`,
    })
  }

  const visit = (node: ts.Node): void => {
    if (ts.isBindingElement(node)) {
      const key = bindingElementKey(node)
      const source = findDestructuringSource(node)
      if (key && source && isGlobalObjectExpression(source) && pageRuleForGlobal(key)) {
        report(key, lineOf(node))
      }
    }

    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      const key = assignmentPropertyKey(node)
      const source = findDestructuringSource(node)
      if (key && source && isGlobalObjectExpression(source) && pageRuleForGlobal(key)) {
        report(key, lineOf(node))
      }
    }

    // 类型别名、类型引用与 `typeof fetch` 的 TypeQuery 都不会在运行时取得原语；
    // `typeof window.fetch` 同样不能当作页面持有传输能力的证据。
    if (!ts.isPartOfTypeNode(node) && !(node.parent && ts.isTypeQueryNode(node.parent))) {
      if (
        ts.isIdentifier(node)
        && !isPropertyName(node)
        && !isBindingName(node)
        && !isAssignmentPatternShorthand(node)
        && !moduleValueNames.has(node.text)
        && pageRuleForGlobal(node.text)
      ) {
        report(node.text, lineOf(node))
      }

      if (
        ts.isPropertyAccessExpression(node)
        && isGlobalObjectExpression(node.expression)
        && ts.isIdentifier(node.name)
        && pageRuleForGlobal(node.name.text)
      ) {
        report(node.name.text, lineOf(node.name))
      }

      if (ts.isElementAccessExpression(node) && isGlobalObjectExpression(node.expression)) {
        const argument = node.argumentExpression
          ? unwrapExpression(node.argumentExpression)
          : undefined
        if (argument && ts.isStringLiteralLike(argument) && pageRuleForGlobal(argument.text)) {
          report(argument.text, lineOf(argument))
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
}

function importsPageInfrastructure(
  specifier: string,
  resolved: string | null,
): boolean {
  if (specifier === '@tanstack/react-query' || specifier.startsWith('@tanstack/react-query/')) {
    return true
  }
  if (!resolved) return false
  return resolved === 'shared/api/index.ts'
    || resolved.startsWith('shared/api/')
    || resolved === 'shared/query/index.ts'
    || resolved.startsWith('shared/query/')
}

function collectLocalImportSources(sourceFile: ts.SourceFile): Map<string, string> {
  const sources = new Map<string, string>()

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) {
      continue
    }

    const clause = statement.importClause
    if (!clause || clause.isTypeOnly) continue
    const specifier = statement.moduleSpecifier.text

    if (clause.name) sources.set(clause.name.text, specifier)

    const namedBindings = clause.namedBindings
    if (!namedBindings) continue

    if (ts.isNamespaceImport(namedBindings)) {
      sources.set(namedBindings.name.text, specifier)
      continue
    }

    for (const element of namedBindings.elements) {
      if (element.isTypeOnly) continue
      sources.set(element.name.text, specifier)
    }
  }

  return sources
}

function buildPublicApiExports(files: readonly SourceFile[]): Map<string, Set<string>> {
  const filesByPath = new Map(files.map(file => [file.path, file]))
  const knownFiles = new Set(filesByPath.keys())
  const apiExports = new Map<string, Set<string>>()

  const addExport = (domain: string, name: string): void => {
    let names = apiExports.get(domain)
    if (!names) {
      names = new Set()
      apiExports.set(domain, names)
    }
    names.add(name)
  }

  for (const file of files) {
    const domain = /^features\/([^/]+)\/index\.tsx?$/.exec(file.path)?.[1]
    if (!domain) continue

    const sourceFile = parseSourceFile(file)
    const localImportSources = collectLocalImportSources(sourceFile)

    for (const reExport of collectReExports(file.source, file.path)) {
      if (reExport.typeOnly) continue
      const specifier = reExport.specifier
        ?? (reExport.localName ? localImportSources.get(reExport.localName) : undefined)
      if (!specifier) continue
      const target = resolveImport(specifier, file.path, knownFiles)
      if (!target?.startsWith(`features/${domain}/api/`)) continue

      if (reExport.exportedName === '*') {
        for (const name of collectModuleExportedNames(target, filesByPath, knownFiles, new Set())) {
          // `export *` 不转发 default；default 可能来自页面组件，不能当作端点。
          if (name !== 'default') addExport(domain, name)
        }
      } else {
        addExport(domain, reExport.exportedName)
      }
    }

    for (const statement of sourceFile.statements) {
      if (!ts.isExportAssignment(statement) || statement.isExportEquals) continue
      const localName = unwrappedIdentifierName(statement.expression)
      const specifier = localName ? localImportSources.get(localName) : undefined
      if (!specifier) continue
      const target = resolveImport(specifier, file.path, knownFiles)
      if (target?.startsWith(`features/${domain}/api/`)) addExport(domain, 'default')
    }
  }

  return apiExports
}

export function checkPageGuardrails(files: readonly SourceFile[]): GuardrailViolation[] {
  const knownFiles = new Set(files.map(file => file.path))
  const publicApiExports = buildPublicApiExports(files)
  const violations: GuardrailViolation[] = []

  for (const file of files) {
    if (!isPageFile(file.path)) continue
    const pageDomain = pageDomainOf(file.path)
    const sourceFile = parseSourceFile(file)

    for (const reference of collectImportReferences(file.source, file.path)) {
      if (reference.typeOnly) continue
      const resolved = resolveImport(reference.specifier, file.path, knownFiles)

      if (importsPageInfrastructure(reference.specifier, resolved)) {
        violations.push({
          rule: 'page-transport',
          file: file.path,
          message: `页面不得直接依赖传输层或 Query 基础设施（${reference.specifier}）；读取/写入交给领域容器与领域 Query`,
        })
        continue
      }

      if (pageDomain && resolved?.startsWith(`features/${pageDomain}/api/`)) {
        violations.push({
          rule: 'page-transport',
          file: file.path,
          message: `页面不得直接导入本域 API（${reference.specifier}）；读取/写入交给领域容器与领域查询`,
        })
      }
    }

    for (const usage of collectDynamicImportUsages(sourceFile)) {
      const resolved = resolveImport(usage.specifier, file.path, knownFiles)
      const domain = resolved ? isFeatureIndex(resolved)?.domain : null
      const apiNames = domain ? publicApiExports.get(domain) : undefined
      if (!domain || !apiNames?.size) continue

      const endpoints = [...usage.usedNames].filter(name => apiNames.has(name))
      if (endpoints.length === 0) continue
      violations.push({
        rule: 'page-transport',
        file: file.path,
        message: `页面不得动态 import 领域公开面并调用端点 ${domain}.${endpoints.join(', ')}（${usage.specifier}）；请在领域容器中使用所需 hook/组件`,
      })
    }

    for (const binding of collectImportBindings(file.source, file.path)) {
      if (binding.typeOnly) continue
      const resolved = resolveImport(binding.specifier, file.path, knownFiles)
      const domain = resolved ? isFeatureIndex(resolved)?.domain : null
      const apiNames = domain ? publicApiExports.get(domain) : undefined
      if (!domain || !apiNames?.size) continue

      if (binding.imported === '*') {
        const usedNames = collectPropertyUsage(sourceFile, binding.localName)
        const endpoints = [...usedNames].filter(name => apiNames.has(name))
        if (endpoints.length === 0) continue
        violations.push({
          rule: 'page-transport',
          file: file.path,
          message: `页面不得经公开面调用领域端点 ${domain}.${endpoints.join(', ')}（${binding.specifier}）；请交给领域容器/hook`,
        })
      } else if (apiNames.has(binding.imported)) {
        violations.push({
          rule: 'page-transport',
          file: file.path,
          message: `页面不得经公开面直接调用领域端点 ${domain}.${binding.imported}（${binding.specifier}）；请交给领域容器/hook`,
        })
      }
    }

    collectPageGlobalViolations(file, violations)
  }

  return violations
}

interface RegionAnchor {
  attribute: string
  value?: string
}

const LAYOUT_REGION_CONTRACT: Readonly<Record<string, readonly RegionAnchor[]>> = {
  'app/layout/Layout.tsx': [
    { attribute: 'data-region', value: 'scroll' },
    { attribute: 'data-region', value: 'page-content' },
  ],
  'app/layout/AppNavbar.tsx': [
    { attribute: 'data-region', value: 'navbar' },
    { attribute: 'data-region', value: 'page-header' },
    { attribute: 'data-region', value: 'page-title' },
  ],
  'app/layout/AppSidebar.tsx': [
    { attribute: 'data-region', value: 'sidebar' },
    { attribute: 'data-region', value: 'sidebar-brand' },
  ],
  'app/layout/AppTabbar.tsx': [
    { attribute: 'data-region', value: 'tabbar' },
  ],
  'shared/components/PageShell.tsx': [
    { attribute: 'data-region', value: 'page' },
    { attribute: 'data-page-kind' },
    { attribute: 'data-page-layout' },
    { attribute: 'data-page-surface' },
  ],
}

function collectJsxAttributes(sourceFile: ts.SourceFile): Map<string, Set<string | null>> {
  const attributes = new Map<string, Set<string | null>>()

  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name)) {
      const name = node.name.text
      let values = attributes.get(name)
      if (!values) {
        values = new Set<string | null>()
        attributes.set(name, values)
      }
      values.add(
        node.initializer && ts.isStringLiteral(node.initializer)
          ? node.initializer.text
          : null,
      )
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return attributes
}

function hasRegionAnchor(
  attributes: ReadonlyMap<string, ReadonlySet<string | null>>,
  anchor: RegionAnchor,
): boolean {
  const values = attributes.get(anchor.attribute)
  if (!values) return false
  return anchor.value === undefined || values.has(anchor.value)
}

function formatRegionAnchor(anchor: RegionAnchor): string {
  return anchor.value === undefined ? anchor.attribute : `${anchor.attribute}="${anchor.value}"`
}

export function checkLayoutRegions(files: readonly SourceFile[]): GuardrailViolation[] {
  const filesByPath = new Map(files.map(file => [file.path, file]))
  const violations: GuardrailViolation[] = []

  for (const [filePath, anchors] of Object.entries(LAYOUT_REGION_CONTRACT)) {
    const file = filesByPath.get(filePath)
    if (!file) {
      violations.push({
        rule: 'layout-region',
        file: filePath,
        message: `缺少布局文件：${filePath}，无法核对壳层稳定锚点`,
      })
      continue
    }

    const attributes = collectJsxAttributes(parseSourceFile(file))
    for (const anchor of anchors) {
      if (hasRegionAnchor(attributes, anchor)) continue
      violations.push({
        rule: 'layout-region',
        file: filePath,
        message: `缺少壳层稳定锚点：${formatRegionAnchor(anchor)}`,
      })
    }
  }

  return violations
}

const GLOBAL_STYLE_FILES = [
  'styles/index.css',
  'styles/layout.css',
  'styles/ios-theme.css',
] as const

const GLOBAL_STYLE_FORBIDDEN_SELECTORS: readonly RegExp[] = [
  /\[data-page-kind\b/,
  /\.(?:automation|combat|roguelike|training|statistics|logs|dashboard|settings|config)-/,
]

interface CssSelectorPrelude {
  selector: string
  index: number
}

function stripCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '))
}

function collectCssSelectorPreludes(css: string): CssSelectorPrelude[] {
  const preludes: CssSelectorPrelude[] = []
  let segmentStart = 0
  let quote: string | null = null
  let depth = 0

  for (let index = 0; index < css.length; index += 1) {
    const character = css[index]

    if (quote) {
      if (character === '\\') {
        index += 1
      } else if (character === quote) {
        quote = null
      }
      continue
    }

    if (character === '"' || character === "'") {
      quote = character
      continue
    }

    if (character === '{') {
      const raw = css.slice(segmentStart, index)
      const selector = raw.trim()
      if (selector && !selector.startsWith('@')) {
        preludes.push({
          selector,
          index: segmentStart + (raw.length - raw.trimStart().length),
        })
      }
      depth += 1
      segmentStart = index + 1
    } else if (character === '}') {
      depth = Math.max(0, depth - 1)
      segmentStart = index + 1
    } else if (character === ';' && depth === 0) {
      segmentStart = index + 1
    }
  }

  return preludes
}

function lineNumberAt(source: string, index: number): number {
  let line = 1
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source[cursor] === '\n') line += 1
  }
  return line
}

function compactSelector(selector: string): string {
  const compact = selector.replace(/\s+/g, ' ')
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact
}

export function checkGlobalStyleScope(files: readonly SourceFile[]): GuardrailViolation[] {
  const filesByPath = new Map(files.map(file => [file.path, file]))
  const violations: GuardrailViolation[] = []

  for (const filePath of GLOBAL_STYLE_FILES) {
    const file = filesByPath.get(filePath)
    if (!file) {
      violations.push({
        rule: 'global-style-scope',
        file: filePath,
        message: `缺少全局样式文件：${filePath}，无法核对页面选择器`,
      })
      continue
    }

    const css = stripCssComments(file.source)
    for (const prelude of collectCssSelectorPreludes(css)) {
      for (const pattern of GLOBAL_STYLE_FORBIDDEN_SELECTORS) {
        const match = pattern.exec(prelude.selector)
        if (!match) continue
        const line = lineNumberAt(css, prelude.index)
        violations.push({
          rule: 'global-style-scope',
          file: filePath,
          message: `全局样式不得包含页面或领域选择器（第 ${line} 行：${compactSelector(prelude.selector)}；命中 ${match[0]}）`,
        })
        break
      }
    }
  }

  return violations
}

const LAYOUT_TEST_FILE_PATTERN = /\.layout\.test\.tsx$/
const LAYOUT_TEST_STYLE_PROPERTIES = new Set([
  'width',
  'height',
  'top',
  'left',
  'right',
  'bottom',
  'display',
  'maxHeight',
])
const LAYOUT_TEST_INVOCATION_KEYS = new Set(['behavior', 'block'])
const LAYOUT_TEST_SELECTOR_FUNCTIONS = new Set(['querySelector', 'querySelectorAll'])

function isClassSelectorArgument(argument: ts.Expression | undefined): boolean {
  if (!argument) return false
  const expression = unwrapExpression(argument)
  return ts.isStringLiteralLike(expression) && expression.text.trimStart().startsWith('.')
}

function callExpressionName(node: ts.CallExpression): string | null {
  const expression = unwrapExpression(node.expression)
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return null
}

function objectLiteralContainsKey(node: ts.Node, keys: ReadonlySet<string>): boolean {
  if (ts.isObjectLiteralExpression(node)) {
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue
      const key = assignmentPropertyKey(property)
      if (key !== null && keys.has(key)) return true
    }
  }

  let found = false
  ts.forEachChild(node, (child) => {
    if (found) return
    if (objectLiteralContainsKey(child, keys)) found = true
  })
  return found
}

function collectLayoutTestViolations(file: SourceFile, violations: GuardrailViolation[]): void {
  const sourceFile = parseSourceFile(file)
  const report = (node: ts.Node, detail: string): void => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
    violations.push({
      rule: 'layout-test-detail',
      file: file.path,
      message: `布局测试不得锁定实现细节（第 ${line} 行：${detail}）`,
    })
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = callExpressionName(node)
      if (name === 'toHaveClass') report(node, 'toHaveClass')
      if (name === 'toHaveStyle') report(node, 'toHaveStyle')
      if (
        (name === 'toHaveBeenCalledWith' || name === 'toHaveBeenLastCalledWith')
        && node.arguments.some(argument => objectLiteralContainsKey(argument, LAYOUT_TEST_INVOCATION_KEYS))
      ) {
        report(node, `${name} 的 behavior/block 精确参数`)
      }
      if (
        name !== null
        && LAYOUT_TEST_SELECTOR_FUNCTIONS.has(name)
        && isClassSelectorArgument(node.arguments[0])
      ) {
        report(node, `${name} 的类选择器`)
      }
    }

    if (ts.isPropertyAccessExpression(node)) {
      const member = node.name.text
      if (member === 'classList') report(node, 'classList')
      if (member === 'previousElementSibling' || member === 'nextElementSibling') report(node, member)
      if (
        LAYOUT_TEST_STYLE_PROPERTIES.has(member)
        && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'style'
      ) {
        report(node, `.style.${member}`)
      }
    }

    if (ts.isElementAccessExpression(node)) {
      const member = staticMemberName(node)
      if (member === 'classList') report(node, 'classList')
      if (
        member !== null
        && LAYOUT_TEST_STYLE_PROPERTIES.has(member)
        && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'style'
      ) {
        report(node, `.style.${member}`)
      }
    }

    if (ts.isStringLiteralLike(node) && node.text.includes('data-align')) report(node, 'data-align')
    if (
      ts.isJsxAttribute(node)
      && ts.isIdentifier(node.name)
      && node.name.text === 'data-align'
    ) {
      report(node, 'data-align')
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
}

export function checkLayoutTestDetails(files: readonly SourceFile[]): GuardrailViolation[] {
  const layoutTests = files.filter(file => LAYOUT_TEST_FILE_PATTERN.test(file.path))
  if (layoutTests.length === 0) {
    return [{
      rule: 'layout-test-detail',
      file: 'src/**/*.layout.test.tsx',
      message: '未找到布局测试文件，无法核对测试是否锁定实现细节',
    }]
  }

  const violations: GuardrailViolation[] = []
  for (const file of layoutTests) collectLayoutTestViolations(file, violations)
  return violations
}

export async function readSourceTree(srcRoot: string): Promise<SourceFile[]> {
  return readMatchingTree(srcRoot, name => /\.(?:ts|tsx)$/.test(name))
}

export async function readStyleTree(srcRoot: string): Promise<SourceFile[]> {
  return readMatchingTree(srcRoot, name => name.endsWith('.css'))
}

async function readMatchingTree(
  root: string,
  matches: (name: string) => boolean,
): Promise<SourceFile[]> {
  const files: SourceFile[] = []

  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))

    for (const entry of entries) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute)
        continue
      }
      if (!matches(entry.name)) continue
      files.push({
        path: path.relative(root, absolute).split(path.sep).join('/'),
        source: await readFile(absolute, 'utf8'),
      })
    }
  }

  await walk(root)
  return files
}
