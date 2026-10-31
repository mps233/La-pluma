import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractCallbackPayloads,
  parseDepotData,
  parseDepotPayloadData,
  parseOperBoxData,
  selectRecognitionPayload
} from '../dataParserService.js';

function callbackLine(payload) {
  return `[2026-10-31 12:00:00.000][INF][Px1][Tx1] Assistant::append_callback | SubTaskExtraInfo ${JSON.stringify(payload)}`;
}

function depotPayload({ done = true, data = { 2001: 12000 } } = {}) {
  return {
    class: 'asst::DepotRecognitionTask',
    details: { data: JSON.stringify(data), done },
    what: 'DepotInfo',
    taskchain: 'Depot'
  };
}

test('extracts a callback regardless of what/details field order', () => {
  const ordered = callbackLine(depotPayload());
  const reversed = callbackLine({
    what: 'DepotInfo',
    details: { done: true, data: JSON.stringify({ 30011: 5 }) },
    class: 'asst::DepotRecognitionTask',
    taskchain: 'Depot'
  });

  assert.equal(extractCallbackPayloads(ordered, 'DepotInfo').length, 1);
  assert.equal(extractCallbackPayloads(reversed, 'DepotInfo').length, 1);
});

test('ignores unrelated callback lines and truncated payloads', () => {
  const other = callbackLine({ what: 'OperBoxInfo', details: {} });
  const truncated = 'Assistant::append_callback | SubTaskExtraInfo {"what":"DepotInfo","details":';

  assert.deepEqual(extractCallbackPayloads(other, 'DepotInfo'), []);
  assert.deepEqual(extractCallbackPayloads(truncated, 'DepotInfo'), []);
});

test('prefers the last completed recognition payload over a later partial one', () => {
  const payloads = [
    { details: { done: true, data: '{"2001":1}' } },
    { details: { done: false, data: '{"2001":2}' } }
  ];

  const selected = selectRecognitionPayload(payloads, payload => Boolean(payload.details?.data));
  assert.equal(selected.complete, true);
  assert.equal(selected.payload.details.data, '{"2001":1}');
});

test('reports an incomplete payload when no completed result exists', () => {
  const selected = selectRecognitionPayload(
    [{ details: { done: false, data: '{"2001":2}' } }],
    payload => Boolean(payload.details?.data)
  );

  assert.equal(selected.complete, false);
  assert.equal(selected.payload.details.data, '{"2001":2}');
});

test('parses DepotInfo data from both string and object values', () => {
  assert.deepEqual(parseDepotPayloadData({ data: '{"2001":12000}' }), { 2001: 12000 });
  assert.deepEqual(parseDepotPayloadData({ data: { 2001: 12000 } }), { 2001: 12000 });
  assert.equal(parseDepotPayloadData({}), null);
});

test('parseDepotData returns a structured error when no DepotInfo exists', async () => {
  const result = await parseDepotData({
    logPath: '/tmp/la-pluma-missing-asst.log',
    logContent: callbackLine({ what: 'OperBoxInfo', details: {} })
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'AGENT_DEPOT_NOT_FOUND');
  assert.equal(result.error.statusCode, 404);
  assert.equal(result.error.retryable, true);
});

test('parseDepotData reports an unreadable log instead of returning success', async () => {
  const result = await parseDepotData({ logPath: '/tmp/la-pluma-does-not-exist/asst.log' });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'AGENT_DEPOT_LOG_UNAVAILABLE');
  assert.equal(result.error.statusCode, 500);
  assert.equal(result.error.retryable, true);
});

test('parseDepotData reports malformed payload data as a parse failure', async () => {
  const result = await parseDepotData({
    logPath: '/tmp/la-pluma-asst.log',
    logContent: callbackLine({
      class: 'asst::DepotRecognitionTask',
      details: { data: '{bad json', done: true },
      what: 'DepotInfo',
      taskchain: 'Depot'
    })
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'AGENT_DEPOT_PARSE_FAILED');
  assert.equal(result.error.statusCode, 500);
});

test('parseOperBoxData does not report an incomplete recognition as success', async () => {
  const result = await parseOperBoxData({
    logPath: '/tmp/la-pluma-asst.log',
    logContent: callbackLine({
      class: 'asst::OperBoxRecognitionTask',
      details: { done: false, own_opers: [{ id: 'char_002_amiya' }] },
      what: 'OperBoxInfo',
      taskchain: 'OperBox'
    })
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'AGENT_OPERBOX_RECOGNITION_INCOMPLETE');
  assert.equal(result.error.statusCode, 409);
});
