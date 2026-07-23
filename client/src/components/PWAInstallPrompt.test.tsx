// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasDocumentBuildChanged } from '@/utils/pwaUpdate'
import PWAInstallPrompt from './PWAInstallPrompt'

const swMock = vi.hoisted(() => ({
  needRefresh: false,
  setNeedRefresh: vi.fn(),
  updateServiceWorker: vi.fn().mockResolvedValue(undefined),
  registerOptions: undefined as Record<string, unknown> | undefined,
}))

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options: Record<string, unknown>) => {
    swMock.registerOptions = options
    return {
      needRefresh: [swMock.needRefresh, swMock.setNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: swMock.updateServiceWorker,
    }
  },
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface InstallPromptEvent extends Event {
  prompt: ReturnType<typeof vi.fn>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let container: HTMLDivElement
let root: Root

const setNavigator = (userAgent: string, maxTouchPoints = 0) => {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: userAgent,
  })
  Object.defineProperty(window.navigator, 'maxTouchPoints', {
    configurable: true,
    value: maxTouchPoints,
  })
}

const createInstallPromptEvent = (outcome: 'accepted' | 'dismissed' = 'accepted') => {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as InstallPromptEvent
  event.prompt = vi.fn().mockResolvedValue(undefined)
  event.userChoice = Promise.resolve({ outcome })
  return event
}

const renderPrompt = async () => {
  await act(async () => {
    root.render(<PWAInstallPrompt />)
  })
}

const clickButton = async (label: string) => {
  const button = Array.from(container.querySelectorAll('button'))
    .find(candidate => candidate.textContent?.includes(label) || candidate.getAttribute('aria-label') === label)
  expect(button).toBeDefined()
  await act(async () => {
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('PWAInstallPrompt', () => {
  beforeEach(() => {
    swMock.needRefresh = false
    swMock.setNeedRefresh.mockReset()
    swMock.updateServiceWorker.mockReset().mockResolvedValue(undefined)
    swMock.registerOptions = undefined
    window.localStorage.clear()
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    setNavigator('Mozilla/5.0 Chrome/126.0 Safari/537.36')

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('offers the captured browser installation prompt', async () => {
    await renderPrompt()
    const installEvent = createInstallPromptEvent()

    act(() => window.dispatchEvent(installEvent))
    expect(container.textContent).toContain('安装 La Pluma')

    await clickButton('安装')
    expect(installEvent.prompt).toHaveBeenCalledOnce()
  })

  it('shows iOS Add to Home Screen guidance', async () => {
    setNavigator('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', 5)
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 639px)' || query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))

    await renderPrompt()

    const installEntry = container.querySelector<HTMLButtonElement>('[aria-label="安装 La Pluma"]')
    expect(installEntry).not.toBeNull()
    expect(installEntry?.classList.contains('pwa-install-entry-button')).toBe(true)
    expect(installEntry?.classList.contains('app-icon-button-size-md')).toBe(true)
    expect(installEntry?.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('.pwa-install-entry')?.classList.contains('fixed')).toBe(true)
    expect(container.querySelector('.pwa-install-prompt')).toBeNull()
    expect(container.textContent).not.toContain('在 Safari 工具栏中点击“分享”')

    await clickButton('安装 La Pluma')

    expect(container.querySelector('.pwa-install-entry')).toBeNull()
    expect(container.querySelector('.pwa-install-prompt')).not.toBeNull()
    expect(container.textContent).toContain('在 Safari 工具栏中点击“分享”')
    expect(container.textContent).toContain('选择“添加到主屏幕”')
  })

  it('reminds again after a seven-day installation dismissal', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'))
    await renderPrompt()
    act(() => window.dispatchEvent(createInstallPromptEvent()))
    await clickButton('稍后')

    expect(window.localStorage.getItem('pwa-install-dismissed-at')).toBe(String(Date.now()))

    await act(async () => root.unmount())
    root = createRoot(container)
    await renderPrompt()
    act(() => window.dispatchEvent(createInstallPromptEvent()))
    expect(container.textContent).not.toContain('安装 La Pluma')

    await act(async () => root.unmount())
    root = createRoot(container)
    vi.advanceTimersByTime(7 * 24 * 60 * 60 * 1000)
    await renderPrompt()
    act(() => window.dispatchEvent(createInstallPromptEvent()))
    expect(container.textContent).toContain('安装 La Pluma')
  })

  it('keeps a deferred update recoverable after collapsing it', async () => {
    swMock.needRefresh = true
    await renderPrompt()

    expect(container.textContent).toContain('发现新版本')
    const updateRegion = container.querySelector('[role="region"]')
    expect(updateRegion?.getAttribute('aria-labelledby')).toBe('pwa-prompt-title')
    expect(container.querySelector('[role="status"]')?.textContent).toContain('发现新版本')
    await clickButton('稍后')
    expect(container.textContent).toContain('应用更新')

    await clickButton('应用更新')
    expect(container.textContent).toContain('发现新版本')
    await clickButton('立即更新')
    expect(swMock.updateServiceWorker).toHaveBeenCalledWith(true)
  })

  it('checks for an update when the app returns to the foreground', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-23T00:00:00Z'))
    const update = vi.fn().mockResolvedValue(undefined)
    await renderPrompt()

    const onRegisteredSW = swMock.registerOptions?.onRegisteredSW as
      | ((url: string, registration: ServiceWorkerRegistration) => void)
      | undefined
    expect(onRegisteredSW).toBeTypeOf('function')
    onRegisteredSW?.('/sw.js', { update } as unknown as ServiceWorkerRegistration)

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })
    expect(update).toHaveBeenCalledOnce()

    await act(async () => {
      window.dispatchEvent(new Event('pageshow'))
      await Promise.resolve()
    })
    expect(update).toHaveBeenCalledOnce()

    vi.advanceTimersByTime(60 * 1000)
    await act(async () => {
      window.dispatchEvent(new Event('pageshow'))
      await Promise.resolve()
    })
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('detects a changed document bundle without relying on a service worker', async () => {
    const currentDocument = document.implementation.createHTMLDocument()
    currentDocument.head.innerHTML = `
      <script type="module" src="/assets/index-old.js"></script>
      <link rel="stylesheet" href="/assets/index-old.css">
    `
    const fetchDocument = vi.fn().mockResolvedValue({
      ok: true,
      url: 'http://console.test/',
      text: vi.fn().mockResolvedValue(`
        <script type="module" src="/assets/index-new.js"></script>
        <link rel="stylesheet" href="/assets/index-new.css">
      `),
    } as unknown as Response)

    await expect(hasDocumentBuildChanged({
      appUrl: new URL('http://console.test/'),
      currentDocument,
      fetchDocument,
    })).resolves.toBe(true)

    expect(fetchDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        href: expect.stringContaining('la-pluma-update-check='),
      }),
      expect.objectContaining({
        cache: 'no-store',
        credentials: 'same-origin',
      }),
    )
  })

  it('keeps the current document when its bundle is already up to date', async () => {
    const currentDocument = document.implementation.createHTMLDocument()
    currentDocument.head.innerHTML = `
      <script type="module" src="/assets/index-current.js"></script>
      <link rel="stylesheet" href="/assets/index-current.css">
    `
    const fetchDocument = vi.fn().mockResolvedValue({
      ok: true,
      url: 'http://console.test/',
      text: vi.fn().mockResolvedValue(`
        <script type="module" src="/assets/index-current.js"></script>
        <link rel="stylesheet" href="/assets/index-current.css">
      `),
    } as unknown as Response)

    await expect(hasDocumentBuildChanged({
      appUrl: new URL('http://console.test/'),
      currentDocument,
      fetchDocument,
    })).resolves.toBe(false)
  })
})
