import { asErrorWithCode, getErrorCode, getErrorDetails, getErrorStatus } from '../../utils/errors.ts';
import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveConnection, resolveConnectionInput } from '../connectionService.ts'
import type { ResolvedConnection } from '../connectionService.ts'

const savedConnection: ResolvedConnection = {
  profileId: 'tablet',
  adbPath: '/saved/adb',
  address: '127.0.0.1:5555',
  clientType: 'Official'
}

test('connection input resolves the selected profile before applying explicit overrides', async () => {
  let selectedProfile: unknown = null
  const result = await resolveConnectionInput({
    profileId: 'tablet',
    adbPath: ' /custom/adb ',
    address: ' 192.168.1.5:5555 ',
    clientType: 'Bilibili'
  }, {
    allowOverrides: true,
    resolver: async (profileId: unknown) => {
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
      (error: unknown) => {
        assert.equal(getErrorCode(error), 'AGENT_VALIDATION_PROFILE_ID_INVALID')
        assert.equal(getErrorStatus(error), 400)
        assert.equal(asErrorWithCode(error).retryable, false)
        assert.deepEqual(getErrorDetails(error), { profileId })
        return true
      }
    )
  }
})
