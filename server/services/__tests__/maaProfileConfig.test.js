import assert from 'node:assert/strict';
import test from 'node:test';
import TOML from '@iarna/toml';
import {
  getConfig,
  mergeMaaProfileConnection,
  parseMaaProfile,
  saveConfig,
  validateMaaProfileName
} from '../maaService.js';

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
  const profile = parseMaaProfile(existingProfile);

  assert.equal(profile.connection.auto_reconnect, true);
  assert.equal(profile.connection.retry_count, 3);
  assert.deepEqual(profile.connection.ports, [5555, 16384]);
  assert.equal(profile.resource.auto_update, false);
});

test('connection updates preserve unknown profile sections and existing values', () => {
  const parsed = parseMaaProfile(existingProfile);
  const merged = mergeMaaProfileConnection(parsed, {
    connection: {
      address: '192.168.1.10:5555',
      auto_reconnect: false
    }
  });
  const roundTrip = parseMaaProfile(TOML.stringify(merged));

  assert.equal(roundTrip.profile_name, 'daily');
  assert.equal(roundTrip.connection.adb_path, 'adb');
  assert.equal(roundTrip.connection.address, '192.168.1.10:5555');
  assert.equal(roundTrip.connection.auto_reconnect, false);
  assert.equal(roundTrip.connection.retry_count, 3);
  assert.deepEqual(roundTrip.connection.ports, [5555, 16384]);
  assert.deepEqual(roundTrip.resource, { channel: 'beta', auto_update: false });
  assert.deepEqual(roundTrip.instance_options, { touch_mode: 'maatouch' });
});

test('MAA profile names reject traversal before invoking maa-cli', async () => {
  assert.equal(validateMaaProfileName('emulator_2'), 'emulator_2');
  assert.throws(() => validateMaaProfileName('../default'), /连接配置名称不合法/);
  await assert.rejects(getConfig('..%2Fdefault'), /连接配置名称不合法/);
  await assert.rejects(saveConfig('../../default', { connection: {} }), /连接配置名称不合法/);
});
