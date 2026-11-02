import { readdirSync } from 'node:fs';
import path from 'node:path';

const excludedDirectories = new Set(['data', 'debug', 'node_modules', 'dist']);

export function findTestFiles(serverRoot: string): string[] {
  const files: string[] = [];

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || excludedDirectories.has(entry.name)) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
        files.push(entryPath);
      }
    }
  };

  walk(serverRoot);
  return files.sort();
}
