import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const excludedDirectories = new Set(['data', 'debug', 'node_modules']);

async function findTestFiles(directory, insideTestDirectory = false) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.') || excludedDirectories.has(entry.name)) continue;

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findTestFiles(entryPath, insideTestDirectory || entry.name === '__tests__'));
    } else if (insideTestDirectory && entry.name.endsWith('.test.js')) {
      files.push(entryPath);
    }
  }

  return files;
}

const testFiles = (await findTestFiles(serverRoot)).sort();
if (testFiles.length === 0) {
  console.error('No server test files found.');
  process.exitCode = 1;
} else {
  const failures = [];

  for (const testFile of testFiles) {
    const relativePath = path.relative(serverRoot, testFile);
    console.log(`\n▶ ${relativePath}`);

    const result = spawnSync(process.execPath, [testFile], {
      cwd: serverRoot,
      env: process.env,
      stdio: 'inherit',
    });

    if (result.error || result.status !== 0) {
      failures.push(relativePath);
      if (result.error) console.error(result.error.message);
      if (result.signal) console.error(`Test process terminated by ${result.signal}.`);
    }
  }

  const passed = testFiles.length - failures.length;
  console.log(`\nTest files: ${testFiles.length}, passed: ${passed}, failed: ${failures.length}`);

  if (failures.length > 0) {
    console.error(`Failed test files:\n${failures.map(file => `- ${file}`).join('\n')}`);
    process.exitCode = 1;
  }
}
