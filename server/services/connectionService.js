import { getConfig } from './maaService.js'

export const DEFAULT_CONNECTION_PROFILE = 'default'

const DEFAULT_ADB_PATH = process.env.ADB_PATH || '/opt/homebrew/bin/adb'
const DEFAULT_ADB_ADDRESS = process.env.ADB_ADDRESS || '127.0.0.1:16384'
const DEFAULT_CLIENT_TYPE = process.env.MAA_CLIENT_TYPE || 'Official'

export async function resolveConnection(profileId = DEFAULT_CONNECTION_PROFILE) {
  const normalizedProfileId = String(profileId || DEFAULT_CONNECTION_PROFILE).trim()
  if (!/^[A-Za-z0-9_-]+$/.test(normalizedProfileId)) {
    throw new Error('连接配置名称不合法')
  }

  const config = await getConfig(normalizedProfileId)
  return {
    profileId: normalizedProfileId,
    adbPath: config.adb_path || config.adbPath || DEFAULT_ADB_PATH,
    address: config.address || DEFAULT_ADB_ADDRESS,
    clientType: config.client_type || config.clientType || DEFAULT_CLIENT_TYPE
  }
}
