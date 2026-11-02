import assert from 'node:assert/strict';
import test from 'node:test';
import TOML from '@iarna/toml';
import {
  getConfig,
  mergeMaaProfileConnection,
  parseMaaProfile,
  saveConfig,
  validateMaaProfileName
} from '../maaService.ts';
import { isRecord } from '../../utils/errors.ts';

interface MaaProfileDocument extends Record<string, unknown> {
  profile_name?: string;
  connection: {
    adb_path?: string;
    address?: string;
    auto_reconnect?: boolean;
    retry_count?: number;
    ports?: number[];
    preset?: string;
    client_type?: string;
    touch_mode?: string;
  };
  behavior: { auto_reconnect?: boolean };
  resource: { channel?: string; auto_update?: boolean };
  instance_options: { touch_mode?: string };
}

function parseProfile(content: string): MaaProfileDocument {
  const document = parseMaaProfile(content);
  return {
    profile_name: typeof document.profile_name === 'string' ? document.profile_name : undefined,
    connection: isRecord(document.connection) ? document.connection as MaaProfileDocument['connection'] : {},
    behavior: isRecord(document.behavior) ? document.behavior as MaaProfileDocument['behavior'] : {},
    resource: isRecord(document.resource) ? document.resource as MaaProfileDocument['resource'] : {},
    instance_options: isRecord(document.instance_options)
      ? document.instance_options as MaaProfileDocument['instance_options']
      : {}
  };
}

const existingProfile = `
profile_name = "daily"

[connection]
adb_path = "adb"
address = "127.0.0.1:5555"
auto_reconnect = true
retry_count = 3
ports = [5555, 16384]

[resource]
channel = "beta"
auto_update = false

[instance_options]
touch_mode = "maatouch"
`;

test('MAA profile parser preserves native TOML value types', () => {
  const profile = parseProfile(existingProfile);

  assert.equal(profile.connection.auto_reconnect, true);
  assert.equal(profile.connection.retry_count, 3);
  assert.deepEqual(profile.connection.ports, [5555, 16384]);
  assert.equal(profile.resource.auto_update, false);
});

test('connection updates preserve unknown profile sections and existing values', () => {
  const parsed = parseProfile(existingProfile);
  const merged = mergeMaaProfileConnection(parsed, {
    connection: {
      address: '192.168.1.10:5555',
      auto_reconnect: false
    }
  });
  const roundTrip = parseProfile(TOML.stringify(merged as Parameters<typeof TOML.stringify>[0]));

  assert.equal(roundTrip.profile_name, 'daily');
  assert.equal(roundTrip.connection.adb_path, 'adb');
  assert.equal(roundTrip.connection.address, '192.168.1.10:5555');
  // maa-cli 0.7.3+ reads this from [behavior], not [connection].
  assert.equal(roundTrip.connection.auto_reconnect, undefined);
  assert.equal(roundTrip.behavior.auto_reconnect, false);
  assert.equal(roundTrip.connection.retry_count, 3);
  assert.deepEqual(roundTrip.connection.ports, [5555, 16384]);
  assert.deepEqual(roundTrip.resource, { channel: 'beta', auto_update: false });
  assert.deepEqual(roundTrip.instance_options, { touch_mode: 'maatouch' });
});

test('keeps preset in connection and moves touch_mode into instance_options', () => {
  const parsed = parseProfile(existingProfile);
  const merged = mergeMaaProfileConnection(parsed, {
    connection: {
      preset: 'MuMuPro',
      client_type: 'Bilibili',
      touch_mode: 'maafwadb'
    }
  });
  const roundTrip = parseProfile(TOML.stringify(merged as Parameters<typeof TOML.stringify>[0]));

  assert.equal(roundTrip.connection.preset, 'MuMuPro');
  assert.equal(roundTrip.connection.client_type, 'Bilibili');
  assert.equal(roundTrip.connection.touch_mode, undefined);
  assert.deepEqual(roundTrip.instance_options, { touch_mode: 'maafwadb' });
});

test('MAA profile names reject traversal before invoking maa-cli', async () => {
  assert.equal(validateMaaProfileName('emulator_2'), 'emulator_2');
  assert.throws(() => validateMaaProfileName('../default'), /连接配置名称不合法/);
  await assert.rejects(getConfig('..%2Fdefault'), /连接配置名称不合法/);
  await assert.rejects(saveConfig('../../default', { connection: {} }), /连接配置名称不合法/);
});
