import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { BREAKPOINTS } from '../shared/lib/breakpoints'

const SRC_ROOT = fileURLToPath(new URL('..', import.meta.url))
const BREAKPOINT_KEYS = new Set(Object.keys(BREAKPOINTS))
const APPROVED_THRESHOLDS = new Set<number>(Object.values(BREAKPOINTS))

const CSS_EXTENSIONS = new Set(['.css'])
const SCRIPT_EXTENSIONS = new Set(['.ts', '.tsx'])
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'coverage'])
const TEST_FILE_SUFFIXES = ['.test.ts', '.test.tsx']

const MEDIA_AT_RULE_RE = /@media\b\s*([^{]+)\{/gi
const THEME_BREAKPOINT_RE = /--breakpoint-([A-Za-z0-9-]+)\s*:\s*([^;{}]+)/g
const CSS_VARIANT_DIRECTIVE_RE = /@(?:variant|apply)\s+([^;{}]+)/gi
const UNAPPROVED_CSS_VARIANT_RE = /(?:^|[\s:])((?:max-|min-)?\d+xl)(?=:|\s|$)/gi
const UNAPPROVED_NAMED_BREAKPOINT_RE = /(?:^|[\s"'`:])((?:max-|min-)?\d+xl):/gi
const THEME_BREAKPOINT_FILE = 'styles/index.css'
const THEME_BREAKPOINT_NAME = 'workbench'
const LEGACY_WIDTH_FEATURE_RE = /\b(?:min|max)-width\s*:/
const WIDTH_FEATURE_RE = /\bwidth\b/
const PX_VALUE_RE = /(\d+(?:\.\d+)?)px/g
const PAREN_GROUP_RE = /\(([^()]*)\)/g
const INTERPOLATION_RE = /\$\{([^}]*)\}/g
const DOTTED_BREAKPOINT_RE = /^BREAKPOINTS\.([A-Za-z_$][\w$]*)$/
const BRACKETED_BREAKPOINT_RE = /^BREAKPOINTS\[\s*(['"])([A-Za-z_$][\w$]*)\1\s*\]$/
const SINGLE_COMPARISON_RE = /^width\s*(?:<|>=)\s*\d+(?:\.\d+)?px$/
const INTERVAL_COMPARISON_RE = /^\d+(?:\.\d+)?px\s*<=\s*width\s*<\s*\d+(?:\.\d+)?px$/
const ARBITRARY_BREAKPOINT_RE = /\b(?:min|max)-\[[^\]]*\]/g

type MediaQueryProblem =
  | 'legacy-width'
  | 'direction'
  | 'unapproved-threshold'
  | 'non-breakpoint-interpolation'

type DeclarationKind = 'const' | 'let' | 'var' | 'parameter' | 'binding' | 'import'

interface Scope {
  parent: Scope | null
  declarations: Map<string, Declaration[]>
}

interface Declaration {
  kind: DeclarationKind
  scope: Scope
  initializer?: ts.Expression
  importedName?: string
}

interface MatchMediaCall {
  node: ts.CallExpression
  scope: Scope
  recognizedCallee: boolean
}

interface ExportBucket {
  declarations: Declaration[]
  ambiguous: boolean
}

interface ScriptAnalysis {
  file: string
  sourceFile: ts.SourceFile
  exported: Map<string, ExportBucket>
  calls: MatchMediaCall[]
}

interface ResolvedCall {
  file: string
  line: number
  expression: string
  query: string | null
  reason: string | null
}

type ExportTable = Map<string, Declaration | 'ambiguous'>

interface QueryResolution {
  query: string | null
  reason: string | null
}

interface ThemeBreakpointDefinition {
  name: string
  value: string
}

interface CssSourceFile {
  file: string
  source: string
}

type FunctionNode =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration

function collectFiles(dir: string, extensions: Set<string>): string[] {
  return readdirSync(dir).flatMap(entry => {
    if (IGNORED_DIRECTORIES.has(entry)) return []
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return collectFiles(path, extensions)
    return extensions.has(extname(path)) ? [path] : []
  })
}

function isTestFile(file: string): boolean {
  return TEST_FILE_SUFFIXES.some(suffix => file.endsWith(suffix))
}

function location(file: string): string {
  return relative(SRC_ROOT, file)
}

function parseBreakpointKey(expression: string): string | null {
  const dotted = DOTTED_BREAKPOINT_RE.exec(expression)
  if (dotted?.[1] && BREAKPOINT_KEYS.has(dotted[1])) return dotted[1]
  const bracketed = BRACKETED_BREAKPOINT_RE.exec(expression)
  if (bracketed?.[2] && BREAKPOINT_KEYS.has(bracketed[2])) return bracketed[2]
  return null
}

function widthGroups(query: string): string[] {
  return [...query.matchAll(PAREN_GROUP_RE)].flatMap(match => {
    const group = match[1]?.trim()
    return group && WIDTH_FEATURE_RE.test(group) ? [group] : []
  })
}

function numericThresholds(query: string): number[] {
  return [...query.matchAll(PX_VALUE_RE)].map(match => Number(match[1]))
}

function auditMediaQuery(query: string): MediaQueryProblem[] {
  const problems = new Set<MediaQueryProblem>()
  const loweredQuery = query.toLowerCase()
  if (LEGACY_WIDTH_FEATURE_RE.test(loweredQuery)) problems.add('legacy-width')

  for (const match of query.matchAll(INTERPOLATION_RE)) {
    if (!parseBreakpointKey((match[1] ?? '').trim())) problems.add('non-breakpoint-interpolation')
  }

  const staticQuery = loweredQuery.replace(INTERPOLATION_RE, 'EXPR')
  const normalizedQuery = loweredQuery.replace(INTERPOLATION_RE, '0')
  const groups = widthGroups(normalizedQuery)

  if (WIDTH_FEATURE_RE.test(loweredQuery) && groups.length === 0) problems.add('direction')

  for (const group of groups) {
    if (!SINGLE_COMPARISON_RE.test(group) && !INTERVAL_COMPARISON_RE.test(group)) {
      problems.add('direction')
    }
  }
  for (const group of widthGroups(staticQuery)) {
    for (const threshold of numericThresholds(group)) {
      if (!APPROVED_THRESHOLDS.has(threshold)) problems.add('unapproved-threshold')
    }
  }

  return [...problems]
}

function stripCssComments(source: string): string {
  let stripped = ''
  let index = 0
  let quote: "'" | '"' | null = null

  while (index < source.length) {
    const character = source[index]
    if (character === undefined) break

    if (quote) {
      stripped += character
      if (character === '\\') {
        const escaped = source[index + 1]
        if (escaped !== undefined) {
          stripped += escaped
          index += 2
          continue
        }
      }
      if (character === quote) quote = null
      index += 1
      continue
    }

    if (character === '"' || character === "'") {
      quote = character
      stripped += character
      index += 1
      continue
    }

    if (character === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2)
      stripped += ' '
      if (end === -1) {
        stripped += source.slice(index + 2)
        break
      }
      index = end + 2
      continue
    }

    stripped += character
    index += 1
  }

  return stripped
}

function mediaConditionsOf(source: string): string[] {
  return [...stripCssComments(source).matchAll(MEDIA_AT_RULE_RE)].flatMap(match => (
    match[1] ? [match[1].trim()] : []
  ))
}

function collectMediaConditions(file: string): string[] {
  return mediaConditionsOf(readFileSync(file, 'utf8'))
}

function unapprovedNamedBreakpointsOf(source: string): string[] {
  return [...source.matchAll(UNAPPROVED_NAMED_BREAKPOINT_RE)].map(match => match[1] ?? '')
}

function unapprovedCssVariantsOf(source: string): string[] {
  return [...stripCssComments(source).matchAll(CSS_VARIANT_DIRECTIVE_RE)].flatMap(match => {
    const tokens = match[1] ?? ''
    const named = [...tokens.matchAll(UNAPPROVED_CSS_VARIANT_RE)].map(token => token[1] ?? '')
    const arbitrary = [...tokens.matchAll(ARBITRARY_BREAKPOINT_RE)].map(token => token[0])
    return [...named, ...arbitrary]
  })
}

function themeBreakpointDefinitionsOf(source: string): ThemeBreakpointDefinition[] {
  return [...stripCssComments(source).matchAll(THEME_BREAKPOINT_RE)].map(match => ({
    name: match[1] ?? '',
    value: (match[2] ?? '').trim(),
  }))
}

function themeBreakpointProblemsOf(files: CssSourceFile[]): string[] {
  const problems: string[] = []
  const counts = new Map<string, number>()

  for (const { file, source } of files) {
    for (const { name, value } of themeBreakpointDefinitionsOf(source)) {
      counts.set(name, (counts.get(name) ?? 0) + 1)
      if (file !== THEME_BREAKPOINT_FILE) {
        problems.push(`${file}: --breakpoint-${name} outside ${THEME_BREAKPOINT_FILE}`)
      }
      if (name !== THEME_BREAKPOINT_NAME) {
        problems.push(`${file}: unregistered --breakpoint-${name}`)
        continue
      }
      if (value !== `${BREAKPOINTS.workbench}px`) {
        problems.push(`${file}: --breakpoint-workbench is ${value}, expected ${BREAKPOINTS.workbench}px`)
      }
    }
  }

  for (const [name, count] of counts) {
    if (count > 1) problems.push(`duplicate --breakpoint-${name}`)
  }

  return problems
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    && (ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false)
}

function createScope(parent: Scope | null): Scope {
  return { parent, declarations: new Map() }
}

function registerDeclaration(scope: Scope, name: string, declaration: Declaration): void {
  const existing = scope.declarations.get(name)
  if (existing) {
    existing.push(declaration)
    return
  }
  scope.declarations.set(name, [declaration])
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text]
  return name.elements.flatMap(element => (
    ts.isBindingElement(element) ? bindingNames(element.name) : []
  ))
}

function declarationKindOf(list: ts.VariableDeclarationList): DeclarationKind {
  const isConst = (list.flags & ts.NodeFlags.Const) !== 0 && (list.flags & ts.NodeFlags.Using) === 0
  if (isConst) return 'const'
  if ((list.flags & ts.NodeFlags.BlockScoped) === 0) return 'var'
  return 'let'
}

function isFunctionNode(node: ts.Node): node is FunctionNode {
  return ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node)
}

function addExportBucket(
  exported: Map<string, ExportBucket>,
  name: string,
  declarations: Declaration[],
): void {
  const unique = [...new Set(declarations)]
  const existing = exported.get(name)
  if (!existing) {
    exported.set(name, { declarations: unique, ambiguous: unique.length !== 1 })
    return
  }
  const additions = unique.filter(declaration => !existing.declarations.includes(declaration))
  existing.declarations.push(...additions)
  existing.ambiguous = existing.ambiguous || unique.length !== 1 || existing.declarations.length > 1
}

function collectImportBindings(node: ts.ImportDeclaration, scope: Scope): void {
  const clause = node.importClause
  if (!clause || clause.isTypeOnly) return

  const binding = (importedName: string): Declaration => ({
    kind: 'import',
    scope,
    importedName,
  })

  if (clause.name) registerDeclaration(scope, clause.name.text, binding('default'))

  const namedBindings = clause.namedBindings
  if (!namedBindings) return
  if (ts.isNamespaceImport(namedBindings)) {
    registerDeclaration(scope, namedBindings.name.text, binding('*'))
    return
  }
  for (const specifier of namedBindings.elements) {
    if (specifier.isTypeOnly) continue
    registerDeclaration(
      scope,
      specifier.name.text,
      binding(specifier.propertyName?.text ?? specifier.name.text),
    )
  }
}

function analyzeScopes(sourceFile: ts.SourceFile): Pick<ScriptAnalysis, 'exported' | 'calls'> {
  const rootScope = createScope(null)
  const exported = new Map<string, ExportBucket>()
  const calls: MatchMediaCall[] = []
  const pendingExports: Array<{ localName: string; exportName: string }> = []

  const collectVariable = (node: ts.VariableDeclaration, scope: Scope, functionScope: Scope): void => {
    const list = node.parent
    if (!ts.isVariableDeclarationList(list)) return
    const kind = declarationKindOf(list)
    const targetScope = kind === 'var' ? functionScope : scope
    const statement = list.parent
    const isModuleExport = targetScope === scope
      && scope.parent === null
      && ts.isVariableStatement(statement)
      && hasExportModifier(statement)

    if (ts.isIdentifier(node.name)) {
      const declaration: Declaration = { kind, scope: targetScope, initializer: node.initializer }
      registerDeclaration(targetScope, node.name.text, declaration)
      if (isModuleExport) addExportBucket(exported, node.name.text, [declaration])
      return
    }

    for (const name of bindingNames(node.name)) {
      const declaration: Declaration = { kind: 'binding', scope: targetScope }
      registerDeclaration(targetScope, name, declaration)
      if (isModuleExport) addExportBucket(exported, name, [declaration])
    }
  }

  const visitFunction = (node: FunctionNode, scope: Scope): void => {
    const functionScope = createScope(scope)
    if (ts.isFunctionExpression(node) && node.name) {
      registerDeclaration(functionScope, node.name.text, { kind: 'binding', scope: functionScope })
    }
    for (const parameter of node.parameters) {
      for (const name of bindingNames(parameter.name)) {
        registerDeclaration(functionScope, name, { kind: 'parameter', scope: functionScope })
      }
    }
    for (const parameter of node.parameters) {
      if (parameter.initializer) visit(parameter.initializer, functionScope, functionScope)
    }
    if (node.body) visit(node.body, functionScope, functionScope)
  }

  const visit = (node: ts.Node, scope: Scope, functionScope: Scope): void => {
    if (ts.isImportDeclaration(node)) {
      collectImportBindings(node, scope)
      return
    }

    if (ts.isImportEqualsDeclaration(node)) {
      registerDeclaration(scope, node.name.text, { kind: 'binding', scope })
      return
    }

    if (ts.isVariableDeclaration(node)) {
      collectVariable(node, scope, functionScope)
      ts.forEachChild(node, child => visit(child, scope, functionScope))
      return
    }

    if (ts.isFunctionDeclaration(node)) {
      if (node.name) registerDeclaration(scope, node.name.text, { kind: 'binding', scope })
      visitFunction(node, scope)
      return
    }

    if (isFunctionNode(node)) {
      visitFunction(node, scope)
      return
    }

    if (ts.isBlock(node) || ts.isModuleBlock(node) || ts.isCaseBlock(node)) {
      const blockScope = createScope(scope)
      ts.forEachChild(node, child => visit(child, blockScope, functionScope))
      return
    }

    if (ts.isCatchClause(node)) {
      const catchScope = createScope(scope)
      if (node.variableDeclaration) {
        for (const name of bindingNames(node.variableDeclaration.name)) {
          registerDeclaration(catchScope, name, { kind: 'binding', scope: catchScope })
        }
      }
      if (node.block) visit(node.block, catchScope, functionScope)
      return
    }

    if (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) {
      const loopScope = createScope(scope)
      ts.forEachChild(node, child => visit(child, loopScope, functionScope))
      return
    }

    if (ts.isClassDeclaration(node)) {
      if (node.name) registerDeclaration(scope, node.name.text, { kind: 'binding', scope })
      const classScope = createScope(scope)
      ts.forEachChild(node, child => visit(child, classScope, functionScope))
      return
    }

    if (ts.isClassExpression(node)) {
      const classScope = createScope(scope)
      if (node.name) {
        registerDeclaration(classScope, node.name.text, { kind: 'binding', scope: classScope })
      }
      ts.forEachChild(node, child => visit(child, classScope, functionScope))
      return
    }

    if (ts.isExportDeclaration(node)) {
      if (!node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const specifier of node.exportClause.elements) {
          pendingExports.push({
            localName: specifier.propertyName?.text ?? specifier.name.text,
            exportName: specifier.name.text,
          })
        }
      }
      return
    }

    if (ts.isCallExpression(node)) {
      const calleeText = node.expression.getText(sourceFile)
      if (referencesMatchMedia(node.expression) || calleeText.includes('matchMedia')) {
        calls.push({ node, scope, recognizedCallee: isMatchMediaCallee(node.expression) })
      }
      ts.forEachChild(node, child => visit(child, scope, functionScope))
      return
    }

    ts.forEachChild(node, child => visit(child, scope, functionScope))
  }

  visit(sourceFile, rootScope, rootScope)

  for (const { localName, exportName } of pendingExports) {
    const declarations = rootScope.declarations.get(localName) ?? []
    addExportBucket(exported, exportName, declarations.length === 1 ? declarations : [])
  }

  return { exported, calls }
}

function analyzeSource(file: string, source: string): ScriptAnalysis {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const { exported, calls } = analyzeScopes(sourceFile)
  return { file, sourceFile, exported, calls }
}

function buildExportTable(analyses: ScriptAnalysis[]): ExportTable {
  const table: ExportTable = new Map()
  for (const analysis of analyses) {
    for (const [name, bucket] of analysis.exported) {
      const [declaration] = bucket.declarations
      if (bucket.ambiguous || bucket.declarations.length !== 1 || !declaration || table.has(name)) {
        table.set(name, 'ambiguous')
        continue
      }
      table.set(name, declaration)
    }
  }
  return table
}

function unwrapExpression(node: ts.Expression): ts.Expression {
  let current = node
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

function isMatchMediaCallee(expression: ts.Expression): boolean {
  const callee = unwrapExpression(expression)
  if (ts.isIdentifier(callee)) return callee.text === 'matchMedia'
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text === 'matchMedia'
  if (ts.isElementAccessExpression(callee)) {
    const argument = callee.argumentExpression
    return !!argument && ts.isStringLiteralLike(argument) && argument.text === 'matchMedia'
  }
  return false
}

function referencesMatchMedia(expression: ts.Expression): boolean {
  const callee = unwrapExpression(expression)
  if (ts.isIdentifier(callee)) return callee.text === 'matchMedia'
  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text === 'matchMedia' || referencesMatchMedia(callee.expression)
  }
  if (ts.isElementAccessExpression(callee)) {
    const argument = callee.argumentExpression
    const namesMatchMedia = !!argument
      && ts.isStringLiteralLike(argument)
      && argument.text === 'matchMedia'
    return namesMatchMedia || referencesMatchMedia(callee.expression)
  }
  if (ts.isCallExpression(callee)) return referencesMatchMedia(callee.expression)
  return false
}

function breakpointKeyOf(node: ts.Expression): string | null {
  const expression = unwrapExpression(node)
  if (
    ts.isPropertyAccessExpression(expression)
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === 'BREAKPOINTS'
    && ts.isIdentifier(expression.name)
    && BREAKPOINT_KEYS.has(expression.name.text)
  ) {
    return expression.name.text
  }
  if (
    ts.isElementAccessExpression(expression)
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === 'BREAKPOINTS'
  ) {
    const argument = expression.argumentExpression
    if (argument && ts.isStringLiteralLike(argument) && BREAKPOINT_KEYS.has(argument.text)) {
      return argument.text
    }
  }
  return null
}

function findDeclaration(name: string, scope: Scope): Declaration[] | null {
  let current: Scope | null = scope
  while (current) {
    const declarations = current.declarations.get(name)
    if (declarations) return declarations
    current = current.parent
  }
  return null
}

function resolveDeclaredQuery(
  name: string,
  declaration: Declaration,
  exports: ExportTable,
  seen: Set<ts.Node | Declaration>,
): QueryResolution {
  if (declaration.kind !== 'const') {
    return { query: null, reason: `unsupported ${declaration.kind} declaration: ${name}` }
  }
  if (!declaration.initializer) {
    return { query: null, reason: `constant without initializer: ${name}` }
  }
  if (seen.has(declaration.initializer)) {
    return { query: null, reason: `cyclic constant: ${name}` }
  }
  seen.add(declaration.initializer)
  return resolveQueryNode(declaration.initializer, declaration.scope, exports, seen)
}

function resolveImportedQuery(
  name: string,
  declaration: Declaration,
  exports: ExportTable,
  seen: Set<ts.Node | Declaration>,
): QueryResolution {
  const { importedName } = declaration
  if (!importedName || importedName === '*' || importedName === 'default') {
    return { query: null, reason: `unsupported import binding: ${name}` }
  }
  if (seen.has(declaration)) {
    return { query: null, reason: `cyclic import: ${name}` }
  }
  seen.add(declaration)
  const exported = exports.get(importedName)
  if (!exported) return { query: null, reason: `unresolved import: ${name}` }
  if (exported === 'ambiguous') return { query: null, reason: `ambiguous import: ${name}` }
  if (exported.kind === 'import') {
    return resolveImportedQuery(name, exported, exports, seen)
  }
  return resolveDeclaredQuery(name, exported, exports, seen)
}

function resolveQueryNode(
  node: ts.Expression,
  scope: Scope,
  exports: ExportTable,
  seen: Set<ts.Node | Declaration>,
): QueryResolution {
  const expression = unwrapExpression(node)

  if (ts.isStringLiteralLike(expression)) return { query: expression.text, reason: null }

  if (ts.isTemplateExpression(expression)) {
    let query = expression.head.text
    for (const span of expression.templateSpans) {
      const key = breakpointKeyOf(span.expression)
      if (!key) {
        return { query: null, reason: `unsupported template substitution: ${span.expression.getText()}` }
      }
      query += '${BREAKPOINTS.' + key + '}' + span.literal.text
    }
    return { query, reason: null }
  }

  if (ts.isIdentifier(expression)) {
    const declarations = findDeclaration(expression.text, scope)
    if (!declarations) return { query: null, reason: `unresolved identifier: ${expression.text}` }
    const declaration = declarations.length === 1 ? declarations[0] : undefined
    if (!declaration) return { query: null, reason: `ambiguous declaration: ${expression.text}` }
    if (declaration.kind === 'import') {
      return resolveImportedQuery(expression.text, declaration, exports, seen)
    }
    return resolveDeclaredQuery(expression.text, declaration, exports, seen)
  }

  return { query: null, reason: `unsupported expression: ${ts.SyntaxKind[expression.kind]}` }
}

function resolveCalls(analysis: ScriptAnalysis, exports: ExportTable): ResolvedCall[] {
  return analysis.calls.map(({ node, scope, recognizedCallee }) => {
    const line = analysis.sourceFile.getLineAndCharacterOfPosition(node.getStart(analysis.sourceFile)).line + 1
    const expression = node.getText(analysis.sourceFile)
    if (!recognizedCallee) {
      return {
        file: analysis.file,
        line,
        expression,
        query: null,
        reason: `unsupported matchMedia callee: ${node.expression.getText(analysis.sourceFile)}`,
      }
    }
    const argument = node.arguments[0]
    if (!argument) return { file: analysis.file, line, expression, query: null, reason: 'missing argument' }
    const resolution = resolveQueryNode(argument, scope, exports, new Set())
    return { file: analysis.file, line, expression, query: resolution.query, reason: resolution.reason }
  })
}

function collectProductionAnalyses(): ScriptAnalysis[] {
  return collectFiles(SRC_ROOT, SCRIPT_EXTENSIONS)
    .filter(file => !isTestFile(file))
    .map(file => analyzeSource(file, readFileSync(file, 'utf8')))
}

function resolveFixture(sources: Record<string, string>): ResolvedCall[] {
  const analyses = Object.entries(sources).map(([file, source]) => analyzeSource(file, source))
  const exports = buildExportTable(analyses)
  return analyses.flatMap(analysis => resolveCalls(analysis, exports))
}

function analyzeFixture(source: string): ResolvedCall[] {
  return resolveFixture({ 'fixture.ts': source })
}

function firstCall(source: string): ResolvedCall {
  const calls = analyzeFixture(source)
  expect(calls).toHaveLength(1)
  const [call] = calls
  if (!call) throw new Error('missing matchMedia call')
  return call
}

describe('responsive breakpoint policy', () => {
  it('keeps CSS viewport queries on approved thresholds and range syntax', () => {
    const conditions = collectFiles(SRC_ROOT, CSS_EXTENSIONS).flatMap(file => (
      collectMediaConditions(file).map(condition => ({ file: location(file), condition }))
    ))
    const viewportQueries = conditions.filter(({ condition }) => widthGroups(condition.toLowerCase()).length > 0)

    expect(viewportQueries.length).toBeGreaterThan(30)
    expect(conditions.flatMap(({ file, condition }) => auditMediaQuery(condition).map(problem => ({
      file,
      condition,
      problem,
    })))).toEqual([])
  })

  it('collects media queries without whitespace, with comments, or in different case', () => {
    const noWhitespace = mediaConditionsOf('@media(width < 641px){.a{color:red}}')
    expect(noWhitespace).toEqual(['(width < 641px)'])
    expect(auditMediaQuery(noWhitespace[0] ?? '')).toContain('unapproved-threshold')

    const commentedAtRule = mediaConditionsOf('@media/**/(width < 641px){.a{color:red}}')
    expect(commentedAtRule).toEqual(['(width < 641px)'])
    expect(auditMediaQuery(commentedAtRule[0] ?? '')).toContain('unapproved-threshold')

    const uppercase = mediaConditionsOf('@MEDIA(WIDTH < 641px){.a{color:red}}')
    expect(uppercase).toEqual(['(WIDTH < 641px)'])
    expect(auditMediaQuery(uppercase[0] ?? '')).toContain('unapproved-threshold')

    const commentWithBrace = mediaConditionsOf('@media (width < 641px) /* { */ { .a { color: red } }')
    expect(commentWithBrace).toEqual(['(width < 641px)'])

    const commentedSelector = mediaConditionsOf('@media/**/screen and (width < 641px){.a{color:red}}')
    expect(commentedSelector).toEqual(['screen and (width < 641px)'])
    expect(auditMediaQuery(commentedSelector[0] ?? '')).toContain('unapproved-threshold')

    const quotedCommentMarkers = mediaConditionsOf(
      'content:"/*"; @media (width < 641px){.a{color:red}}; content:"*/"',
    )
    expect(quotedCommentMarkers).toEqual(['(width < 641px)'])

    const unclosedComment = mediaConditionsOf('/* unclosed\n@media (width < 641px){.a{color:red}}')
    expect(unclosedComment).toEqual(['(width < 641px)'])

    const unclosedString = mediaConditionsOf('content:"unclosed @media (width < 641px){.a{color:red}}')
    expect(unclosedString).toEqual(['(width < 641px)'])
  })

  it('rejects unregistered named Tailwind breakpoints and theme definitions', () => {
    const namedVariant = (variant: string, utility: string) => `${variant}:${utility}`

    expect(unapprovedNamedBreakpointsOf(namedVariant('2xl', 'grid-cols-6'))).toEqual(['2xl'])
    expect(unapprovedNamedBreakpointsOf(namedVariant('max-2xl', 'flex'))).toEqual(['max-2xl'])
    expect(unapprovedNamedBreakpointsOf(namedVariant('min-2xl', 'flex'))).toEqual(['min-2xl'])
    expect(unapprovedNamedBreakpointsOf(namedVariant('hover:2xl', 'flex'))).toEqual(['2xl'])
    expect(unapprovedNamedBreakpointsOf(
      'xl:grid-cols-4 workbench:flex md:text-2xl font-bold sm:text-2xl text-2xl/7',
    )).toEqual([])

    expect(themeBreakpointDefinitionsOf('@theme { --breakpoint-2xl: 1536px }'))
      .toEqual([{ name: '2xl', value: '1536px' }])
    expect(themeBreakpointDefinitionsOf('@theme { --breakpoint-workbench: 900px }'))
      .toEqual([{ name: 'workbench', value: '900px' }])
    expect(themeBreakpointDefinitionsOf('@theme { --breakpoint-2xl: 1536px; --breakpoint-workbench: 900px }'))
      .toEqual([{ name: '2xl', value: '1536px' }, { name: 'workbench', value: '900px' }])

    expect(themeBreakpointProblemsOf([
      { file: THEME_BREAKPOINT_FILE, source: '@theme { --breakpoint-workbench: 801px }' },
    ])).not.toEqual([])
    expect(themeBreakpointProblemsOf([
      { file: THEME_BREAKPOINT_FILE, source: '@theme { --breakpoint-2xl: 1536px }' },
    ])).not.toEqual([])
    expect(themeBreakpointProblemsOf([
      { file: 'styles/other.css', source: '@theme { --breakpoint-workbench: 900px }' },
    ])).not.toEqual([])
    expect(themeBreakpointProblemsOf([
      {
        file: THEME_BREAKPOINT_FILE,
        source: '@theme { --breakpoint-workbench: 900px; --breakpoint-workbench: 900px }',
      },
    ])).not.toEqual([])
    expect(themeBreakpointProblemsOf([
      { file: THEME_BREAKPOINT_FILE, source: '@theme { --breakpoint-workbench: 900px }' },
    ])).toEqual([])
  })

  it('rejects unapproved named breakpoint variants in CSS directives', () => {
    const variantDirective = (variant: string) => `.a { @variant ${variant} { display: flex; } }`
    const applyDirective = (utilities: string) => `.a { @apply ${utilities}; }`
    const namedVariant = (variant: string, utility: string) => `${variant}:${utility}`
    const stackedVariant = (variants: string[], utility: string) => `${variants.join(':')}:${utility}`

    expect(unapprovedCssVariantsOf(variantDirective('2xl'))).toEqual(['2xl'])
    expect(unapprovedCssVariantsOf(applyDirective(namedVariant('2xl', 'flex')))).toEqual(['2xl'])
    expect(unapprovedCssVariantsOf(applyDirective(stackedVariant(['hover', '2xl'], 'flex'))))
      .toEqual(['2xl'])
    expect(unapprovedCssVariantsOf(applyDirective([
      namedVariant('max-2xl', 'flex'),
      namedVariant('min-2xl', 'flex'),
    ].join(' ')))).toEqual(['max-2xl', 'min-2xl'])
    expect(unapprovedCssVariantsOf(applyDirective('text-2xl font-bold'))).toEqual([])
  })

  it('rejects arbitrary breakpoint variants in CSS directives', () => {
    const variantDirective = (variant: string) => `.a { @variant ${variant} { display: flex; } }`
    const applyDirective = (utilities: string) => `.a { @apply ${utilities}; }`
    const namedVariant = (variant: string, utility: string) => `${variant}:${utility}`
    const arbitraryToken = (kind: string, value: string) => `${kind}-[${value}]`
    const arbitraryVariant = (kind: string, value: string, utility: string) => (
      `${arbitraryToken(kind, value)}:${utility}`
    )

    expect(unapprovedCssVariantsOf(applyDirective(arbitraryVariant('max', '641px', 'flex'))))
      .toEqual([arbitraryToken('max', '641px')])
    expect(unapprovedCssVariantsOf(applyDirective(arbitraryVariant('min', '900px', 'flex'))))
      .toEqual([arbitraryToken('min', '900px')])
    expect(unapprovedCssVariantsOf(variantDirective(arbitraryToken('min', '900px'))))
      .toEqual([arbitraryToken('min', '900px')])

    expect(unapprovedCssVariantsOf(applyDirective('text-2xl font-bold'))).toEqual([])
    expect(unapprovedCssVariantsOf(applyDirective(namedVariant('max-sm', 'flex')))).toEqual([])
    expect(unapprovedCssVariantsOf(applyDirective(namedVariant('xl', 'grid-cols-4')))).toEqual([])
    expect(unapprovedCssVariantsOf(applyDirective('[color:red]'))).toEqual([])
  })

  it('does not use unapproved breakpoint variants in CSS directives', () => {
    const variants = collectFiles(SRC_ROOT, CSS_EXTENSIONS).flatMap(file => (
      unapprovedCssVariantsOf(readFileSync(file, 'utf8')).map(variant => (
        `${location(file)}: ${variant}`
      ))
    ))
    expect(variants).toEqual([])
  })

  it('does not use unapproved named Tailwind breakpoint variants', () => {
    const variants = collectFiles(SRC_ROOT, SCRIPT_EXTENSIONS)
      .filter(file => !isTestFile(file))
      .flatMap(file => unapprovedNamedBreakpointsOf(readFileSync(file, 'utf8')).map(variant => (
        `${location(file)}: ${variant}`
      )))
    expect(variants).toEqual([])
  })

  it('keeps named breakpoint definitions on the approved file, name and value', () => {
    const cssFiles = collectFiles(SRC_ROOT, CSS_EXTENSIONS).map(file => ({
      file: location(file),
      source: readFileSync(file, 'utf8'),
    }))
    const definitions = cssFiles.flatMap(({ file, source }) => (
      themeBreakpointDefinitionsOf(source).map(definition => ({ file, ...definition }))
    ))

    expect(definitions).toEqual([{
      file: THEME_BREAKPOINT_FILE,
      name: THEME_BREAKPOINT_NAME,
      value: `${BREAKPOINTS.workbench}px`,
    }])
    expect(themeBreakpointProblemsOf(cssFiles)).toEqual([])
  })

  it('audits every production matchMedia call', () => {
    const analyses = collectProductionAnalyses()
    const exported = buildExportTable(analyses)
    const calls = analyses.flatMap(analysis => resolveCalls(analysis, exported))
    const unsupportedCalls = calls.filter(call => call.query === null)
    const supportedCalls = calls.filter((call): call is ResolvedCall & { query: string } => call.query !== null)
    const widthCalls = supportedCalls.filter(call => widthGroups(call.query.toLowerCase()).length > 0)
    const widthCallKeys = new Set(widthCalls.map(call => `${call.file}:${call.expression}`))

    expect(widthCallKeys.size).toBeGreaterThanOrEqual(8)
    expect(unsupportedCalls).toEqual([])
    expect(supportedCalls.flatMap(call => auditMediaQuery(call.query).map(problem => ({
      file: location(call.file),
      line: call.line,
      expression: call.expression,
      problem,
    })))).toEqual([])
  })

  it('recognizes every matchMedia argument form or fails closed', () => {
    const trailingComma = firstCall("window.matchMedia('(width < 601px)',)")
    expect(trailingComma.query).toBe('(width < 601px)')
    expect(auditMediaQuery(trailingComma.query ?? '')).toContain('unapproved-threshold')

    const extraParentheses = firstCall("window.matchMedia(('(width < 602px)'))")
    expect(extraParentheses.query).toBe('(width < 602px)')
    expect(auditMediaQuery(extraParentheses.query ?? '')).toContain('unapproved-threshold')

    const multiline = firstCall("window.matchMedia\n  ('(width < 603px)')")
    expect(multiline.query).toBe('(width < 603px)')
    expect(auditMediaQuery(multiline.query ?? '')).toContain('unapproved-threshold')

    const asConst = firstCall("window.matchMedia('(width < 604px)' as const)")
    expect(asConst.query).toBe('(width < 604px)')
    expect(auditMediaQuery(asConst.query ?? '')).toContain('unapproved-threshold')

    expect(firstCall('window.matchMedia(objectQuery.mobile)').reason).toContain('unsupported')
    expect(firstCall('window.matchMedia(getQuery())').reason).toContain('unsupported')
    expect(firstCall("const concatConst = '(width < ' + '603px)'; window.matchMedia(concatConst)").reason)
      .toContain('unsupported')
  })

  it('recognizes every matchMedia callee form or fails closed', () => {
    const parenthesizedCallee = firstCall("(window.matchMedia)('(width < 607px)')")
    expect(parenthesizedCallee.query).toBe('(width < 607px)')
    expect(auditMediaQuery(parenthesizedCallee.query ?? '')).toContain('unapproved-threshold')

    const elementAccessCallee = firstCall("window['matchMedia']('(width < 606px)')")
    expect(elementAccessCallee.query).toBe('(width < 606px)')
    expect(auditMediaQuery(elementAccessCallee.query ?? '')).toContain('unapproved-threshold')

    const nonNullCallee = firstCall("window.matchMedia!('(width < 609px)')")
    expect(nonNullCallee.query).toBe('(width < 609px)')
    expect(auditMediaQuery(nonNullCallee.query ?? '')).toContain('unapproved-threshold')

    const assertedCallee = firstCall("(window.matchMedia as typeof window.matchMedia)('(width < 610px)')")
    expect(assertedCallee.query).toBe('(width < 610px)')
    expect(auditMediaQuery(assertedCallee.query ?? '')).toContain('unapproved-threshold')

    expect(firstCall("foo.matchMedia.call(null, '(width < 608px)')").reason).toContain('unsupported')
    expect(firstCall("matchMedia.apply(null, ['(width < 608px)'])").reason).toContain('unsupported')
    expect(firstCall("(0, window.matchMedia)('(width < 611px)')").reason).toContain('unsupported')
  })

  it('accepts literal, template, constant, parenthesized and as-const queries', () => {
    const literal = firstCall("window.matchMedia('(width < 640px)')")
    expect(literal.query).toBe('(width < 640px)')
    expect(auditMediaQuery(literal.query ?? '')).toEqual([])

    const optionalCallee = firstCall("window.matchMedia?.('(width < 640px)')")
    expect(optionalCallee.query).toBe('(width < 640px)')
    expect(auditMediaQuery(optionalCallee.query ?? '')).toEqual([])

    const template = firstCall('window.matchMedia(`(width < ${BREAKPOINTS.sm}px)`)')
    expect(template.query).toBe('(width < ${BREAKPOINTS.sm}px)')
    expect(auditMediaQuery(template.query ?? '')).toEqual([])

    const bracketed = firstCall("window.matchMedia(`(width < ${BREAKPOINTS['sm']}px)`)")
    expect(bracketed.query).toBe('(width < ${BREAKPOINTS.sm}px)')
    expect(auditMediaQuery(bracketed.query ?? '')).toEqual([])

    const parenthesized = firstCall("window.matchMedia(('(width >= 1024px)'))")
    expect(parenthesized.query).toBe('(width >= 1024px)')
    expect(auditMediaQuery(parenthesized.query ?? '')).toEqual([])

    const asConst = firstCall("window.matchMedia('(width >= 1280px)' as const)")
    expect(asConst.query).toBe('(width >= 1280px)')
    expect(auditMediaQuery(asConst.query ?? '')).toEqual([])

    const constant = firstCall(
      "const DESKTOP_QUERY = `(width >= ${BREAKPOINTS.lg}px)`; window.matchMedia(DESKTOP_QUERY)",
    )
    expect(constant.query).toBe('(width >= ${BREAKPOINTS.lg}px)')
    expect(auditMediaQuery(constant.query ?? '')).toEqual([])
  })

  it('resolves constants lexically and fails closed on mutable, shadowed or ambiguous bindings', () => {
    const scoped = resolveFixture({
      'fixture.ts': [
        'export function narrow() {',
        "  const QUERY = '(width < 601px)'",
        '  return window.matchMedia(QUERY).matches',
        '}',
        'export function wide() {',
        "  const QUERY = '(width < 640px)'",
        '  return window.matchMedia(QUERY).matches',
        '}',
      ].join('\n'),
    })
    expect(scoped.map(call => call.query)).toEqual(['(width < 601px)', '(width < 640px)'])
    expect(auditMediaQuery(scoped[0]?.query ?? '')).toContain('unapproved-threshold')

    expect(firstCall("let mutableQuery = '(width < 640px)'; window.matchMedia(mutableQuery)").reason)
      .toContain('unsupported')
    expect(firstCall("let mutableQuery = '(width < 640px)'; mutableQuery = '(width < 601px)'; window.matchMedia(mutableQuery)").reason)
      .toContain('unsupported')
    expect(firstCall("var legacyQuery = '(width < 640px)'; window.matchMedia(legacyQuery)").reason)
      .toContain('unsupported')

    const parameterShadow = firstCall(
      "const QUERY = '(width < 640px)'; function check(QUERY: string) { return window.matchMedia(QUERY) }",
    )
    expect(parameterShadow.reason).toContain('unsupported')

    const catchShadow = firstCall(
      "const QUERY = '(width < 640px)'; try {} catch (QUERY) { window.matchMedia(QUERY) }",
    )
    expect(catchShadow.reason).toContain('unsupported')

    const blockShadow = firstCall(
      "const QUERY = '(width < 640px)'; function check() { const QUERY = '(width < 601px)'; return window.matchMedia(QUERY) }",
    )
    expect(blockShadow.query).toBe('(width < 601px)')
    expect(auditMediaQuery(blockShadow.query ?? '')).toContain('unapproved-threshold')

    expect(firstCall("const QUERY = '(width < 640px)'; const QUERY = '(width < 601px)'; window.matchMedia(QUERY)").reason)
      .toContain('ambiguous')
  })

  it('resolves imported constants through a unique export table or fails closed', () => {
    const imported = resolveFixture({
      'remote.ts': "export const QUERY = '(width < 640px)'",
      'importer.ts': "import { QUERY } from './remote'; window.matchMedia(QUERY)",
    })
    expect(imported).toHaveLength(1)
    expect(imported[0]?.query).toBe('(width < 640px)')

    const aliased = resolveFixture({
      'remote.ts': "const QUERY = '(width < 640px)'; export { QUERY as REMOTE_QUERY }",
      'importer.ts': "import { REMOTE_QUERY } from './remote'; window.matchMedia(REMOTE_QUERY)",
    })
    expect(aliased[0]?.query).toBe('(width < 640px)')

    const reExported = resolveFixture({
      'remote.ts': "export const QUERY = '(width < 640px)'; export { QUERY }",
      'importer.ts': "import { QUERY } from './remote'; window.matchMedia(QUERY)",
    })
    expect(reExported[0]?.query).toBe('(width < 640px)')

    const ambiguousImports = resolveFixture({
      'one.ts': "export const QUERY = '(width < 640px)'",
      'two.ts': "export const QUERY = '(width < 601px)'",
      'importer.ts': "import { QUERY } from './one'; window.matchMedia(QUERY)",
    })
    expect(ambiguousImports).toHaveLength(1)
    expect(ambiguousImports[0]?.reason).toContain('ambiguous')

    const mutableImport = resolveFixture({
      'remote.ts': "export let QUERY = '(width < 640px)'",
      'importer.ts': "import { QUERY } from './remote'; window.matchMedia(QUERY)",
    })
    expect(mutableImport[0]?.reason).toContain('unsupported')

    const missingImport = resolveFixture({
      'importer.ts': "import { QUERY } from './missing'; window.matchMedia(QUERY)",
    })
    expect(missingImport[0]?.reason).toContain('unresolved import')

    const shadowedImport = resolveFixture({
      'remote.ts': "export const QUERY = '(width < 640px)'",
      'importer.ts': "import { QUERY } from './remote'; function check(QUERY: string) { window.matchMedia(QUERY) }",
    })
    expect(shadowedImport[0]?.reason).toContain('unsupported')
  })

  it('rejects legacy, non-range, unregistered, nested and uppercase queries', () => {
    expect(SINGLE_COMPARISON_RE.test('width < 640px')).toBe(true)
    expect(SINGLE_COMPARISON_RE.test('width >= 640px')).toBe(true)
    expect(SINGLE_COMPARISON_RE.test('width <= 900px')).toBe(false)
    expect(SINGLE_COMPARISON_RE.test('width > 900px')).toBe(false)
    expect(SINGLE_COMPARISON_RE.test('width < 39.5rem')).toBe(false)
    expect(INTERVAL_COMPARISON_RE.test('768px <= width < 1280px')).toBe(true)
    expect(INTERVAL_COMPARISON_RE.test('768px <= width <= 1279px')).toBe(false)

    expect(auditMediaQuery('screen and (max-width: 900px)')).toContain('legacy-width')
    expect(auditMediaQuery('(width < 601px)')).toContain('unapproved-threshold')
    expect(auditMediaQuery('(width < ${601}px)')).toContain('non-breakpoint-interpolation')
    expect(auditMediaQuery('(width < ${BREAKPOINTS.unknown}px)')).toContain('non-breakpoint-interpolation')
    expect(auditMediaQuery('(width <= 900px)')).toContain('direction')
    expect(auditMediaQuery('(width > 900px)')).toContain('direction')
    expect(auditMediaQuery('(WIDTH < 641px)')).toContain('unapproved-threshold')
    expect(auditMediaQuery('(MAX-WIDTH: 900px)')).toContain('legacy-width')
    expect(auditMediaQuery('(width < calc(641px))')).toContain('direction')
    expect(auditMediaQuery('(width < min(641px, 900px))')).toContain('direction')

    const uppercaseThreshold = firstCall("window.matchMedia('(WIDTH < 605px)')")
    expect(auditMediaQuery(uppercaseThreshold.query ?? '')).toContain('unapproved-threshold')
    const uppercaseLegacy = firstCall("window.matchMedia('(MAX-WIDTH: 900px)')")
    expect(auditMediaQuery(uppercaseLegacy.query ?? '')).toContain('legacy-width')

    expect(auditMediaQuery('(width < ${BREAKPOINTS.sm}px)')).toEqual([])
    expect(auditMediaQuery('(width < ${BREAKPOINTS[\'sm\']}px)')).toEqual([])
    expect(auditMediaQuery('screen and (width >= ${BREAKPOINTS.lg}px)')).toEqual([])
    expect(auditMediaQuery('(768px <= width < 1280px)')).toEqual([])
  })

  it('does not use arbitrary min/max breakpoints in scripts', () => {
    const arbitrary = collectFiles(SRC_ROOT, SCRIPT_EXTENSIONS).flatMap(file => (
      [...readFileSync(file, 'utf8').matchAll(ARBITRARY_BREAKPOINT_RE)].map(match => (
        `${location(file)}: ${match[0]}`
      ))
    ))

    expect(arbitrary).toEqual([])
  })
})
