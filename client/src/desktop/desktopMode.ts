/** Runtime flag injected by the MyGo desktop shell before the app scripts. */
export function isDesktopRuntime(): boolean {
  if (typeof window === 'undefined') return false
  return (window as Window & { __LA_PLUMA_DESKTOP__?: boolean }).__LA_PLUMA_DESKTOP__ === true
}