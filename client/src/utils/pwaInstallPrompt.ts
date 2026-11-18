export const PWA_INSTALL_REQUEST_EVENT = 'la-pluma-pwa-install-request'

/** Ask the app-level install prompt to reveal its install entry. */
export function requestPwaInstall(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(PWA_INSTALL_REQUEST_EVENT))
}
