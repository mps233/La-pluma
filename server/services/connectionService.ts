import { getConfig, validateMaaProfileName } from './maaService.ts'
import { agentError } from '../utils/apiHelper.ts'
import { DEFAULT_ADB_ADDRESS, DEFAULT_ADB_PATH, DEFAULT_CLIENT_TYPE } from '../config/connectionDefaults.ts'

const DEFAULT_CONNECTION_PROFILE = 'default'

export interface ResolvedConnection {
  profileId: string
  adbPath: string
  address: string
  clientType: string
}

export async function resolveConnection(profileId: unknown = DEFAULT_CONNECTION_PROFILE): Promise<ResolvedConnection> {
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

export async function resolveConnectionInput(
  input: unknown = {},
  { allowOverrides = false, resolver = resolveConnection }: {
    allowOverrides?: boolean
    resolver?: (profileId: unknown) => Promise<ResolvedConnection>
  } = {}
): Promise<ResolvedConnection> {
  const source = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
  const base = await resolver(source.profileId)
  if (!allowOverrides) return base

  return {
    ...base,
    adbPath: typeof source.adbPath === 'string' && source.adbPath.trim() ? source.adbPath.trim() : base.adbPath,
    address: typeof source.address === 'string' && source.address.trim() ? source.address.trim() : base.address,
    clientType: typeof source.clientType === 'string' && source.clientType.trim() ? source.clientType.trim() : base.clientType
  }
}
