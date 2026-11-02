export const DEFAULT_ADB_PATH = process.env.ADB_PATH || '/opt/homebrew/bin/adb';
export const DEFAULT_ADB_ADDRESS = process.env.ADB_ADDRESS || '127.0.0.1:16384';
export const DEFAULT_CLIENT_TYPE = process.env.MAA_CLIENT_TYPE || 'Official';
export const DEFAULT_MAA_CLI_PATH = process.env.MAA_CLI_PATH || (process.env.DOCKER_ENV ? '/usr/local/bin/maa' : 'maa');
