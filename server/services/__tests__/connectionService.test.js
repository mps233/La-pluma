import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveConnection, resolveConnectionInput } from '../connectionService.js'

const savedConnection = {
  profileId: 'tablet',
  adbPath: '/saved/adb',
  address: '127.0.0.1:5555',
  clientType: 'Official'
}

test('connection input resolves the selected profile before applying explicit overrides', async () => {
  let selectedProfile = null
  const result = await resolveConnectionInput({
    profileId: 'tablet',
    adbPath: ' /custom/adb ',
    address: ' 192.168.1.5:5555 ',
    clientType: 'Bilibili'
  }, {
    allowOverrides: true,
    resolver: async profileId => {
      selectedProfile = profileId
      return savedConnection
    }
  })

  assert.equal(selectedProfile, 'tablet')
  assert.deepEqual(result, {
    profileId: 'tablet',
    adbPath: '/custom/adb',
    address: '192.168.1.5:5555',
    clientType: 'Bilibili'
  })
})

test('connection input preserves saved values when overrides are disabled', async () => {
  const result = await resolveConnectionInput({ address: '10.0.0.2:5555' }, {
    resolver: async () => savedConnection
  })

  assert.deepEqual(result, savedConnection)
})

test('connection input ignores blank override values', async () => {
  const result = await resolveConnectionInput({ adbPath: ' ', address: '', clientType: '\t' }, {
    allowOverrides: true,
    resolver: async () => savedConnection
  })

  assert.deepEqual(result, savedConnection)
})

test('connection profiles reject unsafe ids with a stable validation error', async () => {
  for (const profileId of ['', '../default', '_hidden', 'a'.repeat(65)]) {
    await assert.rejects(
      resolveConnection(profileId),
      error => {
        assert.equal(error.code, 'AGENT_VALIDATION_PROFILE_ID_INVALID')
        assert.equal(error.statusCode, 400)
        assert.equal(error.retryable, false)
        assert.deepEqual(error.details, { profileId })
        return true
      }
    )
  }
})
