import { getErrorMessage } from '../utils/errors.ts';
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
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--test',
      '--test-concurrency=1',
      '--experimental-test-coverage',
      ...testFiles
    ],
    {
      cwd: serverRoot,
      env: {
        ...process.env,
        LA_PLUMA_MAA_LOCK_FILE: path.join(os.tmpdir(), `la-pluma-coverage-lock-${process.pid}.lock`)
      },
      stdio: 'inherit'
    }
  );

  if (result.error) console.error(result.error.message);
  if (result.signal) console.error(`Test process terminated by ${result.signal}.`);
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}
