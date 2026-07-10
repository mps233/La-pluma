import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectCurrentPenguinActivity } from '../activityFallbackService.js';

const activeWindow = {
  CN: {
    exist: true,
    openTime: 1000,
    closeTime: 3000
  }
};

describe('activity fallback selection', () => {
  it('selects the newest active activity and derives its stage code', () => {
    const zones = [
      {
        zoneId: 'old_zone',
        type: 'ACTIVITY',
        zoneName: '旧活动',
        existence: { CN: { exist: true, openTime: 500, closeTime: 3000 } }
      },
      {
        zoneId: 'act21mini_zone1',
        type: 'ACTIVITY',
        zoneName: '丛林症结',
        existence: activeWindow
      }
    ];
    const stages = [
      { zoneId: 'act21mini_zone1', code: 'BD-8', existence: activeWindow },
      { zoneId: 'act21mini_zone1', code: 'BD-1', existence: activeWindow },
      { zoneId: 'old_zone', code: 'OLD-1', existence: activeWindow }
    ];

    assert.deepEqual(selectCurrentPenguinActivity(zones, stages, 'CN', 2000), {
      code: 'BD',
      name: '丛林症结',
      source: 'penguin',
      startTime: 1000,
      endTime: 3000,
      stages: ['BD-1', 'BD-8']
    });
  });

  it('ignores future and expired activities', () => {
    const zones = [
      {
        zoneId: 'future',
        type: 'ACTIVITY',
        zoneName: '未来活动',
        existence: { CN: { exist: true, openTime: 3000, closeTime: 4000 } }
      },
      {
        zoneId: 'expired',
        type: 'ACTIVITY',
        zoneName: '过期活动',
        existence: { CN: { exist: true, openTime: 500, closeTime: 1500 } }
      }
    ];

    assert.equal(selectCurrentPenguinActivity(zones, [], 'CN', 2000), null);
  });

  it('does not treat permanent or non-activity zones as current events', () => {
    const zones = [{
      zoneId: 'main_1',
      type: 'MAINLINE',
      zoneName: '主线',
      existence: activeWindow
    }];
    const stages = [{ zoneId: 'main_1', code: '1-7', existence: activeWindow }];

    assert.equal(selectCurrentPenguinActivity(zones, stages, 'CN', 2000), null);
  });
});
