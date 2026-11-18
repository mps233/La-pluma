export const ONBOARDING_SEEN_KEY = 'onboarding-seen-at'

export function hasSeenOnboarding(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const seenAt = Number(window.localStorage.getItem(ONBOARDING_SEEN_KEY))
    return Number.isFinite(seenAt) && seenAt > 0
  } catch {
    return false
  }
}

export function markOnboardingSeen(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ONBOARDING_SEEN_KEY, String(Date.now()))
  } catch {
    // The guide stays available from the Dashboard entry when storage is unavailable.
  }
}
