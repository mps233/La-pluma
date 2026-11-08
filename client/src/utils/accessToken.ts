export const ACCESS_TOKEN_STORAGE_KEY = 'laPlumaToken'
export const AUTH_REQUIRED_EVENT = 'la-pluma-auth-required'
export const TOKEN_CHANGED_EVENT = 'la-pluma-token-changed'

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

function normalizeToken(value: string): string {
  const token = value.trim().replace(/^Bearer\s+/i, '').trim()
  return CONTROL_CHARACTERS.test(token) ? '' : token
}

export function readAccessToken(): string {
  if (typeof localStorage === 'undefined') return ''
  try {
    return normalizeToken(localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY) || '')
  } catch {
    return ''
  }
}

export function writeAccessToken(value: string): string {
  const token = normalizeToken(value)
  if (typeof localStorage !== 'undefined') {
    try {
      if (token) localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token)
      else localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY)
    } catch {
      // Storage can be unavailable in private windows; callers still retry.
    }
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(TOKEN_CHANGED_EVENT))
  return token
}

export function clearAccessToken(): void {
  writeAccessToken('')
}

export function notifyAuthRequired(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT))
}