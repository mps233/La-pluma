import assert from 'node:assert/strict';
import test from 'node:test';
import { canUseMaaSelfUpdate } from '../maaService.js';

test('detects a maa-cli build with the self subcommand', async () => {
  const calls = [];
  const available = await canUseMaaSelfUpdate({
    execute: async (...args) => {
      calls.push(args);
      return { stdout: 'Usage: maa self' };
    }
  });

  assert.equal(available, true);
  assert.deepEqual(calls[0], ['self', ['--help'], null, null, true, true]);
});

test('detects a maa-cli build without the self subcommand', async () => {
  const available = await canUseMaaSelfUpdate({
    execute: async () => {
      throw new Error("unrecognized subcommand 'self'");
    }
  });

  assert.equal(available, false);
});
