import { readdirSync, readFileSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirectories = new Set(['node_modules', 'data', 'debug', 'dist']);

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry: Dirent) => {
    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name)
        ? []
        : collectTypeScriptFiles(resolve(directory, entry.name));
    }
    return entry.isFile() && entry.name.endsWith('.ts')
      ? [resolve(directory, entry.name)]
      : [];
  });
}

const files = collectTypeScriptFiles(rootDir).sort();
const failures: Array<{ file: string; message: string }> = [];

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const parseDiagnostics = (sourceFile as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics || [];
  for (const diagnostic of parseDiagnostics) {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    const position = diagnostic.start === undefined
      ? ''
      : `:${sourceFile.getLineAndCharacterOfPosition(diagnostic.start).line + 1}`;
    failures.push({ file: relative(rootDir, file) + position, message });
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`\n${failure.file}\n${failure.message}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Syntax check passed for ${files.length} TypeScript files.`);
}
