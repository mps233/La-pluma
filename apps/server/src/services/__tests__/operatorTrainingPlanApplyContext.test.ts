import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'la-pluma-apply-context-'));
const cacheDirectory = path.join(dataDirectory, 'maa-cache');
const eventCacheDirectory = path.join(dataDirectory, 'maa-cache-event');
const unreadableCacheDirectory = path.join(dataDirectory, 'maa-cache-unreadable');
const previousDataDirectory = process.env.LA_PLUMA_TRAINING_DATA_DIR;
const previousCacheDirectory = process.env.MAA_CACHE_DIR;

await mkdir(cacheDirectory, { recursive: true });
await mkdir(eventCacheDirectory, { recursive: true });
await mkdir(unreadableCacheDirectory, { recursive: true });
await writeFile(path.join(cacheDirectory, 'StageActivityV2.json'), JSON.stringify({
  Official: {},
  YoStarEN: {}
}));
await writeFile(path.join(eventCacheDirectory, 'StageActivityV2.json'), JSON.stringify({
  Official: {
    resourceCollection: {
      Tip: 'SUPPLIES & CHIPS EVERYDAY ACCESS',
      UtcStartTime: '2026/10/27 00:00:00',
      UtcExpireTime: '2026/10/29 23:59:59',
      TimeZone: 0,
      IsResourceCollection: true
    }
  },
  YoStarEN: {}
}));
await writeFile(path.join(unreadableCacheDirectory, 'StageActivityV2.json'), '{invalid');

process.env.LA_PLUMA_TRAINING_DATA_DIR = dataDirectory;
process.env.MAA_CACHE_DIR = cacheDirectory;

const { resolveTrainingPlanApplyContext } = await import('../operatorTrainingPlan.ts');
const { getApplicableStages } = await import('../operatorTrainingModel.ts');
const { loggerManager } = await import('../../utils/logger.ts');
loggerManager.getLogger('OperatorTraining').enableConsole = false;
loggerManager.getLogger('MaaService').enableConsole = false;

after(async () => {
  restoreEnv('LA_PLUMA_TRAINING_DATA_DIR', previousDataDirectory);
  restoreEnv('MAA_CACHE_DIR', previousCacheDirectory);
  await rm(dataDirectory, { recursive: true, force: true });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

const NOW = new Date(Date.UTC(2026, 9, 28, 8, 0, 0));
const OFFICIAL_GAME_DATE = '2026-10-28';

describe('training plan apply context', () => {
  it('keeps the context stable for a fixed instant and normalized client type', async () => {
    const plan = { openStages: [{ stage: 'LS-6', totalTimes: 1 }] };
    const first = await resolveTrainingPlanApplyContext(plan, { now: NOW, clientType: 'yostaren' });
    const second = await resolveTrainingPlanApplyContext(plan, { now: NOW, clientType: 'YoStarEN' });

    assert.deepEqual(first, second);
    assert.equal(first.gameDate, '2026-10-27');
    assert.equal(first.clientType, 'YoStarEN');
    assert.deepEqual(first.closedStages, []);
  });

  it('treats an empty openStages array as authoritative', async () => {
    const plan = {
      openStages: [],
      stages: [{ stage: 'LS-6', totalTimes: 1, isOpen: true }]
    };
    const result = await resolveTrainingPlanApplyContext(plan, { now: NOW, clientType: 'Official' });

    assert.deepEqual(result.intendedStages, []);
    assert.deepEqual(result.closedStages, []);
    assert.deepEqual(getApplicableStages(plan), []);
  });

  it('falls back to stages not marked closed when openStages is absent', async () => {
    const plan = {
      stages: [
        { stage: 'CE-6', totalTimes: 1, isOpen: false },
        { stage: 'CA-5', totalTimes: 2, isOpen: true },
        { stage: 'LS-6', totalTimes: 1 }
      ]
    };
    const result = await resolveTrainingPlanApplyContext(plan, { now: NOW, clientType: 'Official' });

    assert.deepEqual(result.intendedStages, ['CA-5', 'LS-6']);
    assert.deepEqual(result.closedStages, []);
  });

  it('reports resource stages closed by the weekly schedule', async () => {
    const plan = { openStages: [{ stage: 'CE-6', totalTimes: 1 }] };
    const result = await resolveTrainingPlanApplyContext(plan, { now: NOW, clientType: 'Official' });

    assert.equal(result.planGameDate, null);
    assert.equal(result.planClientType, null);
    assert.deepEqual(result.intendedStages, ['CE-6']);
    assert.deepEqual(result.closedStages, ['CE-6']);
  });

  it('resolves plans without summary', async () => {
    const plan = { openStages: [{ stage: 'LS-6', totalTimes: 1 }] };
    const result = await resolveTrainingPlanApplyContext(plan, { now: NOW, clientType: 'Official' });

    assert.equal(result.gameDate, OFFICIAL_GAME_DATE);
    assert.equal(result.planGameDate, null);
    assert.equal(result.planClientType, null);
    assert.equal(result.gameDateMismatch, false);
    assert.equal(result.clientTypeMismatch, false);
    assert.deepEqual(result.closedStages, []);
  });

  it('opens weekly-closed resource stages during a resource collection window', async () => {
    process.env.MAA_CACHE_DIR = eventCacheDirectory;
    try {
      const plan = { openStages: [{ stage: 'CE-6', totalTimes: 1 }] };
      const result = await resolveTrainingPlanApplyContext(plan, { now: NOW, clientType: 'Official' });

      assert.deepEqual(result.closedStages, []);
    } finally {
      process.env.MAA_CACHE_DIR = cacheDirectory;
    }
  });

  it('keeps a same-day summary stage open when the activity table is unreadable', async () => {
    process.env.MAA_CACHE_DIR = unreadableCacheDirectory;
    try {
      const plan = {
        openStages: [{ stage: 'CE-6', totalTimes: 1 }],
        summary: {
          gameDate: OFFICIAL_GAME_DATE,
          clientType: 'Official',
          todayOpenResourceStages: [{ stage: 'CE-6', name: '龙门币', isOpen: true }]
        }
      };
      const result = await resolveTrainingPlanApplyContext(plan, { now: NOW, clientType: 'Official' });
      assert.deepEqual(result.closedStages, []);

      const stale = await resolveTrainingPlanApplyContext({
        ...plan,
        summary: {
          gameDate: '2026-10-27',
          clientType: 'Official',
          todayOpenResourceStages: [{ stage: 'CE-6', name: '龙门币', isOpen: true }]
        }
      }, { now: NOW, clientType: 'Official' });
      assert.equal(stale.gameDateMismatch, true);
      assert.deepEqual(stale.closedStages, ['CE-6']);
    } finally {
      process.env.MAA_CACHE_DIR = cacheDirectory;
    }
  });

  it('exposes game day and client type mismatches', async () => {
    const previousDay = await resolveTrainingPlanApplyContext({
      openStages: [{ stage: 'LS-6', totalTimes: 1 }],
      summary: { gameDate: '2026-10-27', clientType: 'Official' }
    }, { now: NOW, clientType: 'Official' });
    assert.equal(previousDay.gameDateMismatch, true);
    assert.equal(previousDay.clientTypeMismatch, false);
    assert.equal(previousDay.planGameDate, '2026-10-27');
    assert.equal(previousDay.planClientType, 'Official');

    const crossZone = await resolveTrainingPlanApplyContext({
      openStages: [{ stage: 'LS-6', totalTimes: 1 }],
      summary: { gameDate: '2026-10-27', clientType: 'YoStarEN' }
    }, { now: NOW, clientType: 'Official' });
    assert.equal(crossZone.gameDateMismatch, true);
    assert.equal(crossZone.clientTypeMismatch, true);
    assert.equal(crossZone.planClientType, 'YoStarEN');

    const normalized = await resolveTrainingPlanApplyContext({
      openStages: [{ stage: 'LS-6', totalTimes: 1 }],
      summary: { gameDate: OFFICIAL_GAME_DATE, clientType: 'official' }
    }, { now: NOW, clientType: 'Official' });
    assert.equal(normalized.gameDateMismatch, false);
    assert.equal(normalized.clientTypeMismatch, false);
    assert.equal(normalized.planClientType, 'Official');
  });

  it('uses the captured instant for both game day and weekly open state', async () => {
    const plan = { openStages: [{ stage: 'CE-6', totalTimes: 1 }] };
    const before = await resolveTrainingPlanApplyContext(plan, {
      now: new Date(Date.UTC(2026, 9, 28, 19, 59, 59)),
      clientType: 'Official'
    });
    const after = await resolveTrainingPlanApplyContext(plan, {
      now: new Date(Date.UTC(2026, 9, 28, 20, 0, 0)),
      clientType: 'Official'
    });

    assert.equal(before.gameDate, '2026-10-28');
    assert.deepEqual(before.closedStages, ['CE-6']);
    assert.equal(after.gameDate, '2026-10-29');
    assert.deepEqual(after.closedStages, []);
  });
});
