import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GAME_DAY_START_HOUR,
  gameTimeZoneForClientType,
  getGameDay,
  resolveGameZone
} from '../gameCalendar.ts';

test('moves to the next game day at 04:00 service time', () => {
  assert.equal(GAME_DAY_START_HOUR, 4);
  assert.deepEqual(
    getGameDay(new Date('2026-10-28T03:59:00+08:00'), 'Official'),
    { date: '2026-10-27', weekday: 2 }
  );
  assert.deepEqual(
    getGameDay(new Date('2026-10-28T04:00:00+08:00'), 'Official'),
    { date: '2026-10-28', weekday: 3 }
  );
});

test('maps each client service region to its fixed offset and IANA zone', () => {
  const cases = [
    ['Official', 'Asia/Shanghai', 8],
    ['Bilibili', 'Asia/Shanghai', 8],
    ['YoStarJP', 'Asia/Tokyo', 9],
    ['YoStarKR', 'Asia/Seoul', 9],
    ['YoStarEN', 'Etc/GMT+7', -7],
    ['unknown', 'Asia/Shanghai', 8]
  ] as const;

  for (const [clientType, timeZone, offset] of cases) {
    assert.equal(gameTimeZoneForClientType(clientType), timeZone);
    assert.equal(resolveGameZone(clientType).utcOffsetHours, offset);
  }
});

test('computes the same game day independent of the host process time zone', () => {
  const instant = new Date('2026-11-02T03:59:00+08:00');
  assert.deepEqual(getGameDay(instant, 'YoStarJP'), { date: '2026-11-02', weekday: 1 });
  assert.deepEqual(getGameDay(instant, 'YoStarEN'), { date: '2026-11-01', weekday: 0 });
  assert.deepEqual(getGameDay(instant, 'Official'), { date: '2026-11-01', weekday: 0 });
});
