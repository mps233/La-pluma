import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findTestFiles } from './testFiles.ts';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testFiles = findTestFiles(serverRoot);

if (testFiles.length === 0) {
  console.error('No server test files found.');
  process.exitCode = 1;
} else {
  const failures: string[] = [];

  for (const testFile of testFiles) {
    const relativePath = path.relative(serverRoot, testFile);
    console.log(`\n▶ ${relativePath}`);

    const lockFile = path.join(os.tmpdir(), `la-pluma-test-lock-${process.pid}-${path.basename(testFile)}.lock`);
    const result = spawnSync(process.execPath, ['--experimental-strip-types', testFile], {
      cwd: serverRoot,
      env: { ...process.env, LA_PLUMA_MAA_LOCK_FILE: lockFile },
      stdio: 'inherit'
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
    console.error(`Failed test files:\n${failures.map((file: string) => `- ${file}`).join('\n')}`);
    process.exitCode = 1;
  }
}
