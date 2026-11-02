/**
 * 仓库级 TypeScript 门禁：
 * 1. tracked 源码中不允许出现 .js/.jsx/.mjs/.cjs；
 * 2. 每个 tracked .ts/.tsx 必须被 server/client 的 tsconfig include 覆盖；
 * 3. client/server 的 TypeScript 规格、lockfile 解析值与实际安装值必须一致。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const EXPECTED_TYPESCRIPT_VERSION = '5.9.3';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');

const JS_SOURCE_PATTERN = /\.(?:js|jsx|mjs|cjs)$/i;
const TS_SOURCE_PATTERN = /\.(?:ts|tsx|mts|cts)$/i;
function repositorySourceFiles(): string[] {
  const output = execFileSync(
    'git',
    ['-C', repoRoot, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8' }
  );
  return output
    .split('\0')
    .filter(Boolean)
    .filter((file: string) => !/^(?:node_modules|client\/dist|client\/coverage|server\/data|server\/debug)\//.test(file));
}

interface PackageJsonLike {
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
}

interface LockFileLike {
  packages?: Record<string, {
    version?: string;
    devDependencies?: Record<string, string>;
    dependencies?: Record<string, string>;
  }>;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function collectTsconfigFiles(configPath: string): string[] {
  const absoluteConfigPath = path.resolve(repoRoot, configPath);
  const configFile = ts.readConfigFile(absoluteConfigPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(`${configPath}: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')}`);
  }
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(absoluteConfigPath),
    undefined,
    absoluteConfigPath
  );
  if (parsed.errors.length > 0) {
    throw new Error(
      `${configPath}: ${parsed.errors
        .map((error: ts.Diagnostic) => ts.flattenDiagnosticMessageText(error.messageText, '\n'))
        .join('; ')}`
    );
  }
  return parsed.fileNames.map((fileName: string) => path.resolve(fileName));
}

function checkNoJavaScript(files: string[]): string[] {
  return files.filter((file: string) => JS_SOURCE_PATTERN.test(file));
}

function checkTsconfigCoverage(files: string[]): string[] {
  const covered = new Set<string>();
  for (const configPath of ['server/tsconfig.json', 'client/tsconfig.json', 'client/tsconfig.node.json']) {
    for (const fileName of collectTsconfigFiles(configPath)) covered.add(fileName);
  }
  return files
    .filter((file: string) => TS_SOURCE_PATTERN.test(file))
    .filter((file: string) => !covered.has(path.resolve(repoRoot, file)));
}

function checkTypescriptVersion(): string[] {
  const failures: string[] = [];
  for (const packageName of ['client', 'server']) {
    const packagePath = path.join(repoRoot, packageName);
    const packageJson = readJson<PackageJsonLike>(path.join(packagePath, 'package.json'));
    const spec = packageJson.devDependencies?.typescript ?? packageJson.dependencies?.typescript;
    if (spec !== EXPECTED_TYPESCRIPT_VERSION) {
      failures.push(`${packageName}/package.json: typescript 必须是精确版本 ${EXPECTED_TYPESCRIPT_VERSION}，实际为 ${String(spec)}`);
    }

    const lockPath = path.join(packagePath, 'package-lock.json');
    try {
      const lock = readJson<LockFileLike>(lockPath);
      const rootSpec = lock.packages?.['']?.devDependencies?.typescript ?? lock.packages?.['']?.dependencies?.typescript;
      const installedVersion = lock.packages?.['node_modules/typescript']?.version;
      if (rootSpec !== EXPECTED_TYPESCRIPT_VERSION) {
        failures.push(`${packageName}/package-lock.json: 根 devDependencies.typescript 必须是 ${EXPECTED_TYPESCRIPT_VERSION}，实际为 ${String(rootSpec)}`);
      }
      if (installedVersion !== EXPECTED_TYPESCRIPT_VERSION) {
        failures.push(`${packageName}/package-lock.json: node_modules/typescript 解析为 ${String(installedVersion)}，期望 ${EXPECTED_TYPESCRIPT_VERSION}`);
      }
    } catch (error) {
      failures.push(`${packageName}/package-lock.json: ${(error as Error).message}`);
    }

    try {
      const installed = readJson<{ version?: string }>(path.join(packagePath, 'node_modules/typescript/package.json'));
      if (installed.version !== EXPECTED_TYPESCRIPT_VERSION) {
        failures.push(`${packageName}/node_modules/typescript: 实际安装 ${String(installed.version)}，期望 ${EXPECTED_TYPESCRIPT_VERSION}`);
      }
    } catch {
      failures.push(`${packageName}/node_modules/typescript: 未安装，请先执行 npm ci --prefix ${packageName}`);
    }
  }
  return failures;
}

interface AnyUsage {
  anyCount: number;
  catchAny: number;
}

function countExplicitAny(file: string): AnyUsage {
  const content = readFileSync(path.join(repoRoot, file), 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const usage: AnyUsage = { anyCount: 0, catchAny: 0 };

  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) usage.anyCount += 1;
    if (ts.isCatchClause(node) && node.variableDeclaration?.type?.kind === ts.SyntaxKind.AnyKeyword) {
      usage.catchAny += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return usage;
}

function checkAnyUsage(files: string[]): string[] {
  const failures: string[] = [];
  for (const file of files) {
    if (!TS_SOURCE_PATTERN.test(file)) continue;
    const { anyCount, catchAny } = countExplicitAny(file);
    if (catchAny > 0) failures.push(`${file}: catch 变量不允许显式 any，请使用 unknown 并窄化`);
    if (anyCount > 0) failures.push(`${file}: 显式 any ${anyCount} 处，预算 0 处`);
  }
  return failures;
}

const files = repositorySourceFiles();
const jsFiles = checkNoJavaScript(files);
const uncovered = checkTsconfigCoverage(files);
const versionFailures = checkTypescriptVersion();
const anyFailures = checkAnyUsage(files);

if (jsFiles.length > 0) {
  console.error('发现不允许的 JavaScript tracked 源文件：');
  for (const file of jsFiles) console.error(`  - ${file}`);
}
if (uncovered.length > 0) {
  console.error('以下 TypeScript 文件未被任何 tsconfig include 覆盖：');
  for (const file of uncovered) console.error(`  - ${file}`);
}
if (versionFailures.length > 0) {
  console.error('TypeScript 版本门禁失败：');
  for (const failure of versionFailures) console.error(`  - ${failure}`);
}
if (anyFailures.length > 0) {
  console.error('显式 any 门禁失败：');
  for (const failure of anyFailures) console.error(`  - ${failure}`);
}

if (jsFiles.length + uncovered.length + versionFailures.length + anyFailures.length > 0) {
  process.exitCode = 1;
} else {
  console.log(`仓库检查通过：0 个 JS 源文件，${files.filter((file: string) => TS_SOURCE_PATTERN.test(file)).length} 个 TypeScript 文件均被 tsconfig 覆盖，TypeScript ${EXPECTED_TYPESCRIPT_VERSION}。`);
}
