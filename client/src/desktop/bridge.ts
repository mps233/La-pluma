export interface DesktopAppInfo {
  name: string
  version: string
  platform: string
  userData: string
}

interface MyGoRuntime {
  call: (method: string, ...args: unknown[]) => Promise<unknown>
}

declare global {
  interface Window {
    mygo?: MyGoRuntime
  }
}

export function isDesktopRuntime(): boolean {
  if (typeof window === 'undefined') return false
  return (window as Window & { __LA_PLUMA_DESKTOP__?: boolean }).__LA_PLUMA_DESKTOP__ === true
}

async function desktopCall<T>(method: string, ...args: unknown[]): Promise<T> {
  const runtime = window.mygo
  if (!runtime?.call) throw new Error('桌面桥不可用')
  return runtime.call(method, ...args) as Promise<T>
}

export const desktopBridge = {
  appInfo: () => desktopCall<DesktopAppInfo>('DesktopBridge.AppInfo'),
  chooseExecutable: (kind: 'adb' | 'maa') => desktopCall<string>('DesktopBridge.ChooseExecutable', kind),
  openDataDir: () => desktopCall<void>('DesktopBridge.OpenDataDir'),
  openLogs: () => desktopCall<void>('DesktopBridge.OpenLogs'),
  notify: (title: string, body: string) => desktopCall<void>('DesktopBridge.Notify', title, body),
  getAutostart: () => desktopCall<boolean>('DesktopBridge.GetAutostart'),
  setAutostart: (enabled: boolean) => desktopCall<void>('DesktopBridge.SetAutostart', enabled),
}