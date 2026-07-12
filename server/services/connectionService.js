import { getConfig, validateMaaProfileName } from './maaService.js'
import { agentError } from '../utils/apiHelper.js'

export const DEFAULT_CONNECTION_PROFILE = 'default'

const DEFAULT_ADB_PATH = process.env.ADB_PATH || '/opt/homebrew/bin/adb'
const DEFAULT_ADB_ADDRESS = process.env.ADB_ADDRESS || '127.0.0.1:16384'
const DEFAULT_CLIENT_TYPE = process.env.MAA_CLIENT_TYPE || 'Official'

export async function resolveConnection(profileId = DEFAULT_CONNECTION_PROFILE) {
  const normalizedProfileId = String(profileId ?? DEFAULT_CONNECTION_PROFILE).trim()
  try {
    validateMaaProfileName(normalizedProfileId)
  } catch {
    throw agentError('AGENT_VALIDATION_PROFILE_ID_INVALID', '连接配置名称不合法', {
      statusCode: 400,
      details: { profileId },
      retryable: false
    })
  }

  const config = await getConfig(normalizedProfileId)
  return {
    profileId: normalizedProfileId,
    adbPath: config.adb_path || config.adbPath || DEFAULT_ADB_PATH,
    address: config.address || DEFAULT_ADB_ADDRESS,
    clientType: config.client_type || config.clientType || DEFAULT_CLIENT_TYPE
  }
}

export async function resolveConnectionInput(input = {}, { allowOverrides = false, resolver = resolveConnection } = {}) {
  const base = await resolver(input?.profileId)
  if (!allowOverrides) return base

  return {
    ...base,
    adbPath: typeof input.adbPath === 'string' && input.adbPath.trim() ? input.adbPath.trim() : base.adbPath,
    address: typeof input.address === 'string' && input.address.trim() ? input.address.trim() : base.address,
    clientType: typeof input.clientType === 'string' && input.clientType.trim() ? input.clientType.trim() : base.clientType
  }
}
