import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getBattleOcrIntervalMs,
  getBattleOcrScale,
  isBattleOcrEnabled,
  parseBattleCounter,
  preprocessBattleFrame
} from '../battleOcrService.ts';

test('parses a battle counter and normalizes OCR zeroes', () => {
  assert.deepEqual(parseBattleCounter('0/41'), { kills: 0, total: 41 });
  assert.deepEqual(parseBattleCounter('O/41'), { kills: 0, total: 41 });
  assert.deepEqual(parseBattleCounter('17 / 41'), { kills: 17, total: 41 });
  assert.deepEqual(parseBattleCounter('41/41'), { kills: 41, total: 41 });
});

test('rejects non-counter text and impossible values', () => {
  assert.equal(parseBattleCounter(''), null);
  assert.equal(parseBattleCounter('7'), null);
  assert.equal(parseBattleCounter('0/0'), null);
  assert.equal(parseBattleCounter('42/41'), null);
  assert.equal(parseBattleCounter('17/741'), null);
  // The parser cannot know this is the sanity counter; the sampler rejects it
  // by requiring a stable total within the current stage.
  assert.deepEqual(parseBattleCounter('result 14/210'), { kills: 14, total: 210 });
});

test('only accepts a real PNG frame for preprocessing', () => {
  assert.equal(preprocessBattleFrame(Buffer.from('not a png')), null);
  assert.equal(preprocessBattleFrame(Buffer.alloc(0)), null);
});

test('reads the 5 second default and clamps configured intervals', () => {
  const previous = process.env.LA_PLUMA_BATTLE_OCR_INTERVAL_MS;
  try {
    delete process.env.LA_PLUMA_BATTLE_OCR_INTERVAL_MS;
    assert.equal(getBattleOcrIntervalMs(), 5_000);
    process.env.LA_PLUMA_BATTLE_OCR_INTERVAL_MS = '1000';
    assert.equal(getBattleOcrIntervalMs(), 2_000);
    process.env.LA_PLUMA_BATTLE_OCR_INTERVAL_MS = '5000';
    assert.equal(getBattleOcrIntervalMs(), 5_000);
    process.env.LA_PLUMA_BATTLE_OCR_INTERVAL_MS = '999999';
    assert.equal(getBattleOcrIntervalMs(), 60_000);
  } finally {
    if (previous === undefined) delete process.env.LA_PLUMA_BATTLE_OCR_INTERVAL_MS;
    else process.env.LA_PLUMA_BATTLE_OCR_INTERVAL_MS = previous;
  }
});

test('supports disabling battle OCR with environment flags', () => {
  const previous = process.env.LA_PLUMA_BATTLE_OCR;
  try {
    delete process.env.LA_PLUMA_BATTLE_OCR;
    assert.equal(isBattleOcrEnabled(), true);
    for (const value of ['0', 'false', 'off', 'OFF']) {
      process.env.LA_PLUMA_BATTLE_OCR = value;
      assert.equal(isBattleOcrEnabled(), false);
    }
    process.env.LA_PLUMA_BATTLE_OCR = '1';
    assert.equal(isBattleOcrEnabled(), true);
  } finally {
    if (previous === undefined) delete process.env.LA_PLUMA_BATTLE_OCR;
    else process.env.LA_PLUMA_BATTLE_OCR = previous;
  }
});

test('uses a smaller default OCR upscale and clamps the environment override', () => {
  const previous = process.env.LA_PLUMA_BATTLE_OCR_SCALE;
  try {
    delete process.env.LA_PLUMA_BATTLE_OCR_SCALE;
    assert.equal(getBattleOcrScale(), 3);
    process.env.LA_PLUMA_BATTLE_OCR_SCALE = '1';
    assert.equal(getBattleOcrScale(), 2);
    process.env.LA_PLUMA_BATTLE_OCR_SCALE = '9';
    assert.equal(getBattleOcrScale(), 6);
    process.env.LA_PLUMA_BATTLE_OCR_SCALE = '4';
    assert.equal(getBattleOcrScale(), 4);
  } finally {
    if (previous === undefined) delete process.env.LA_PLUMA_BATTLE_OCR_SCALE;
    else process.env.LA_PLUMA_BATTLE_OCR_SCALE = previous;
  }
});
