import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'path';
import { resolveMaaDirs } from '../paths.js';

test('resolves macOS directories like maa-dirs', () => {
  const dirs = resolveMaaDirs({ os: 'darwin', home: '/Users/test', env: {} });

  assert.equal(dirs.data, join('/Users/test', 'Library', 'Application Support', 'com.loong.maa'));
  assert.equal(dirs.state, dirs.data);
  assert.equal(dirs.config, join(dirs.data, 'config'));
  assert.equal(dirs.cache, join('/Users/test', 'Library', 'Caches', 'com.loong.maa'));
});

test('resolves Windows directories like maa-dirs', () => {
  const dirs = resolveMaaDirs({
    os: 'win32',
    home: 'C:/Users/test',
    env: { APPDATA: 'C:/Users/test/AppData/Roaming', LOCALAPPDATA: 'C:/Users/test/AppData/Local' }
  });

  assert.equal(dirs.data, join('C:/Users/test/AppData/Roaming', 'loong', 'maa', 'data'));
  assert.equal(dirs.state, dirs.data);
  assert.equal(dirs.config, join('C:/Users/test/AppData/Roaming', 'loong', 'maa', 'config'));
  assert.equal(dirs.cache, join('C:/Users/test/AppData/Local', 'loong', 'maa', 'cache'));
});

test('resolves Linux XDG directories with a maa suffix', () => {
  const dirs = resolveMaaDirs({
    os: 'linux',
    home: '/home/test',
    env: {
      XDG_DATA_HOME: '/xdg/data',
      XDG_STATE_HOME: '/xdg/state',
      XDG_CONFIG_HOME: '/xdg/config',
      XDG_CACHE_HOME: '/xdg/cache'
    }
  });

  assert.equal(dirs.data, join('/xdg/data', 'maa'));
  assert.equal(dirs.state, join('/xdg/state', 'maa'));
  assert.equal(dirs.config, join('/xdg/config', 'maa'));
  assert.equal(dirs.cache, join('/xdg/cache', 'maa'));
});

test('MAA_* directory variables override platform and XDG defaults', () => {
  const dirs = resolveMaaDirs({
    os: 'linux',
    home: '/home/test',
    env: {
      XDG_DATA_HOME: '/xdg/data',
      XDG_STATE_HOME: '/xdg/state',
      XDG_CONFIG_HOME: '/xdg/config',
      XDG_CACHE_HOME: '/xdg/cache',
      MAA_DATA_DIR: '/custom/data',
      MAA_STATE_DIR: '/custom/state',
      MAA_CONFIG_DIR: '/custom/config',
      MAA_CACHE_DIR: '/custom/cache'
    }
  });

  assert.deepEqual(dirs, {
    data: '/custom/data',
    state: '/custom/state',
    config: '/custom/config',
    cache: '/custom/cache'
  });
});

test('empty directory environment values are treated as unset', () => {
  const dirs = resolveMaaDirs({
    os: 'linux',
    home: '/home/test',
    env: {
      MAA_DATA_DIR: '',
      MAA_STATE_DIR: '   ',
      XDG_DATA_HOME: '',
      XDG_STATE_HOME: '   '
    }
  });

  assert.equal(dirs.data, join('/home/test', '.local', 'share', 'maa'));
  assert.equal(dirs.state, join('/home/test', '.local', 'state', 'maa'));
});
