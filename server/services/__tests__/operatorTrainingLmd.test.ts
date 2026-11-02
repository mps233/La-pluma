import assert from 'node:assert/strict';
import test from 'node:test';
import { getEliteLmdCost } from '../operatorTrainingService.ts';

test('uses explicit LMD costs when present', () => {
  assert.equal(getEliteLmdCost({
    rarity: 6,
    materials: { elite1: { lmd: 12345 } }
  }, 'elite1'), 12345);
});

test('falls back to standard promotion LMD costs by rarity', () => {
  assert.equal(getEliteLmdCost({ rarity: 6, materials: {} }, 'elite1'), 50000);
  assert.equal(getEliteLmdCost({ rarity: 6, materials: {} }, 'elite2'), 210000);
  assert.equal(getEliteLmdCost({ rarity: 5, materials: {} }, 'elite1'), 40000);
  assert.equal(getEliteLmdCost({ rarity: 5, materials: {} }, 'elite2'), 200000);
  assert.equal(getEliteLmdCost({ rarity: 4, materials: {} }, 'elite1'), 30000);
  assert.equal(getEliteLmdCost({ rarity: 4, materials: {} }, 'elite2'), 180000);
  assert.equal(getEliteLmdCost({ rarity: 2, materials: {} }, 'elite1'), 0);
});
