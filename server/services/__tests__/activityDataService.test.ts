import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getStageActivityInfo,
  isResourceCollectionOpen,
  normalizeActivityClientType,
  parseStageActivityTime,
  selectCurrentStageActivity
} from '../activityDataService.ts';

const NOW = Date.UTC(2026, 9, 31, 0, 0, 0);

function activity(stageName: string, start: string, expire: string, stages: string[], timeZone = 8) {
  return {
    MinimumRequired: 'v6.14.0',
    Activity: {
      StageName: stageName,
      UtcStartTime: start,
      UtcExpireTime: expire,
      TimeZone: timeZone
    },
    Stages: stages.map(Value => ({ Value, Display: Value }))
  };
}

const fixture = {
  Official: {
    sideStoryStage: {
      OLD: activity('旧活动', '2026/09/01 16:00:00', '2026/09/10 03:59:59', ['OLD-1']),
      YW: activity('昨日海', '2026/10/09 12:00:00', '2026/10/23 03:59:59', ['YW-8', 'YW-7']),
      ACTIVE: activity('当前活动', '2026/10/30 16:00:00', '2026/11/10 03:59:59', ['AC-1', 'AC-2']),
      REOPEN: activity('复刻活动', '2026/10/20 16:00:00', '2026/10/30 03:59:59', ['SSReopen-AT', 'AT-8', 'AT-7'])
    }
  },
  txwy: {
    sideStoryStage: {
      TW: activity('繁中活动', '2026/10/29 16:00:00', '2026/11/12 03:59:59', ['TW-1'], 8)
    }
  }
};

test('parses StageActivityV2 local times using the declared timezone', () => {
  assert.equal(
    parseStageActivityTime('2026/10/30 16:00:00', 8),
    Date.UTC(2026, 9, 30, 8, 0, 0)
  );
  assert.equal(
    parseStageActivityTime('2026/10/30 16:00:00', 9),
    Date.UTC(2026, 9, 30, 7, 0, 0)
  );
  assert.equal(parseStageActivityTime('not-a-time', 8), null);
});

test('selects the current activity and ignores expired ones', () => {
  const selected = selectCurrentStageActivity(fixture, 'Official', NOW)!;

  assert.equal(selected.code, 'AC');
  assert.equal(selected.name, '当前活动');
  assert.deepEqual(selected.stages, ['AC-1', 'AC-2']);
  assert.equal(selected.source, 'stage-activity');
  assert.ok(selected.startTime < NOW);
  assert.ok(selected.endTime !== null && selected.endTime > NOW);
});

test('derives a usable code from SSReopen stages', () => {
  const selected = selectCurrentStageActivity(fixture, 'Official', Date.UTC(2026, 9, 25, 0, 0, 0))!;

  assert.equal(selected.code, 'AT');
  assert.ok(selected.stages.includes('AT-8'));
  assert.ok(selected.stages.includes('SSReopen-AT'));
});

test('maps Bilibili to the Official activity table and keeps Txwy separate', () => {
  assert.equal(normalizeActivityClientType('Bilibili'), 'Official');
  assert.equal(normalizeActivityClientType('Txwy'), 'txwy');
  assert.equal(normalizeActivityClientType('YostarEN'), 'YostarEN');

  const tw = selectCurrentStageActivity(fixture, 'Txwy', NOW)!;
  assert.equal(tw.code, 'TW');
  assert.equal(tw.name, '繁中活动');
});

test('returns null when the client has no active activity', () => {
  assert.equal(selectCurrentStageActivity(fixture, 'Official', Date.UTC(2027, 0, 1)), null);
  assert.equal(selectCurrentStageActivity({}, 'Official', NOW), null);
});

test('reads StageActivityV2 through the injected reader', async () => {
  const selected = (await getStageActivityInfo('Official', NOW, {
    path: '/tmp/StageActivityV2.json',
    readFileFn: async () => JSON.stringify(fixture)
  }))!;

  assert.equal(selected.code, 'AC');
});

test('detects the resource-collection all-open window without changing weekly rules', () => {
  const data = {
    Official: {
      resourceCollection: {
        Tip: '资源收集',
        UtcStartTime: '2026/10/01 16:00:00',
        UtcExpireTime: '2026/10/20 03:59:59',
        TimeZone: 8,
        IsResourceCollection: true
      }
    }
  };
  assert.equal(isResourceCollectionOpen(data, 'Official', Date.UTC(2026, 9, 5)), true);
  assert.equal(isResourceCollectionOpen(data, 'Official', Date.UTC(2026, 9, 21)), false);
  assert.equal(isResourceCollectionOpen({}, 'Official', Date.UTC(2026, 9, 5)), false);
});
