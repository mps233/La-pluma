// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasDocumentBuildChanged } from '@/utils/pwaUpdate'
import { PWA_INSTALL_REQUEST_EVENT } from '@/utils/pwaInstallPrompt'
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

interface InstallPromptEvent extends Event {
  prompt: ReturnType<typeof vi.fn>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let view: ReturnType<typeof render>
let container: HTMLElement

afterEach(cleanup)

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
  view = render(<PWAInstallPrompt />)
  container = view.container
}

const clickButton = async (label: string) => {
  const button = screen.getByRole('button', { name: label })
  await userEvent.setup().click(button)
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
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('offers the captured browser installation prompt', async () => {
    await renderPrompt()
    const installEvent = createInstallPromptEvent()

    fireEvent(window, installEvent)
    expect(container.textContent).toContain('安装 La Pluma')

    await clickButton('安装')
    await waitFor(() => expect(installEvent.prompt).toHaveBeenCalledOnce())
  })

  it('reopens the install card when another surface requests installation', async () => {
    await renderPrompt()

    fireEvent(window, createInstallPromptEvent())
    expect(container.querySelector('.pwa-install-prompt')).not.toBeNull()

    await clickButton('稍后')
    await waitFor(() => expect(container.querySelector('.pwa-install-prompt')).toBeNull())

    fireEvent(window, new Event(PWA_INSTALL_REQUEST_EVENT))
    expect(container.querySelector('.pwa-install-prompt')).not.toBeNull()
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

    expect(container.querySelector('.pwa-install-entry')).toBeNull()
    expect(container.querySelector('.pwa-install-prompt')).not.toBeNull()
    expect(container.textContent).toContain('在 Safari 工具栏中点击“分享”')
    expect(container.textContent).toContain('选择“添加到主屏幕”')
  })

  it('collapses the desktop install card into an entry until requested', async () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(min-width: 1024px)' || query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    await renderPrompt()
    fireEvent(window, createInstallPromptEvent())

    const installEntry = screen.getByRole('button', { name: '安装 La Pluma' })
    expect(installEntry).not.toBeNull()
    expect(container.querySelector('.pwa-install-prompt')).toBeNull()

    await clickButton('安装 La Pluma')
    await waitFor(() => expect(container.querySelector('.pwa-install-entry')).toBeNull())
    expect(container.querySelector('.pwa-install-prompt')).not.toBeNull()
  })

  it('reminds again after a seven-day installation dismissal', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'))
    await renderPrompt()
    fireEvent(window, createInstallPromptEvent())
    fireEvent.click(screen.getByRole('button', { name: '稍后' }))

    expect(window.localStorage.getItem('pwa-install-dismissed-at')).toBe(String(Date.now()))

    view.unmount()
    await renderPrompt()
    fireEvent(window, createInstallPromptEvent())
    expect(container.textContent).not.toContain('安装 La Pluma')

    view.unmount()
    vi.advanceTimersByTime(7 * 24 * 60 * 60 * 1000)
    await renderPrompt()
    fireEvent(window, createInstallPromptEvent())
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
    await waitFor(() => expect(container.textContent).toContain('应用更新'))

    await clickButton('应用更新')
    await waitFor(() => expect(container.textContent).toContain('发现新版本'))
    await clickButton('立即更新')
    await waitFor(() => expect(swMock.updateServiceWorker).toHaveBeenCalledWith(true))
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

    fireEvent(document, new Event('visibilitychange'))
    expect(update).toHaveBeenCalledOnce()

    fireEvent(window, new Event('pageshow'))
    expect(update).toHaveBeenCalledOnce()

    vi.advanceTimersByTime(60 * 1000)
    fireEvent(window, new Event('pageshow'))
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
