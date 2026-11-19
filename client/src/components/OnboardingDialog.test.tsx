// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OnboardingDialog from './OnboardingDialog'
import {
  ONBOARDING_SEEN_KEY,
  hasSeenOnboarding,
  markOnboardingSeen,
} from '@/utils/onboarding'

const desktopMock = vi.hoisted(() => ({ desktop: false }))
const uiMocks = vi.hoisted(() => ({ setActiveTab: vi.fn() }))
const accessTokenMocks = vi.hoisted(() => ({ notifyAuthRequired: vi.fn() }))
const pwaMocks = vi.hoisted(() => ({ requestPwaInstall: vi.fn() }))

vi.mock('@/desktop/bridge', () => ({
  isDesktopRuntime: () => desktopMock.desktop,
}))

vi.mock('@/stores', () => ({
  useUIStore: (selector: (state: { setActiveTab: typeof uiMocks.setActiveTab }) => unknown) =>
    selector({ setActiveTab: uiMocks.setActiveTab }),
}))

vi.mock('@/utils/accessToken', () => ({
  notifyAuthRequired: accessTokenMocks.notifyAuthRequired,
}))

vi.mock('@/utils/pwaInstallPrompt', () => ({
  requestPwaInstall: pwaMocks.requestPwaInstall,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const findButton = (label: string) => {
  const button = Array.from(document.querySelectorAll('button'))
    .find(candidate => candidate.textContent?.includes(label) || candidate.getAttribute('aria-label') === label)
  expect(button).toBeDefined()
  return button as HTMLButtonElement
}

const click = async (label: string) => {
  await act(async () => {
    findButton(label).dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

const renderDialog = async (isOpen = true, onClose = vi.fn()) => {
  await act(async () => {
    root.render(<OnboardingDialog isOpen={isOpen} onClose={onClose} />)
  })
  return onClose
}

describe('OnboardingDialog', () => {
  beforeEach(() => {
    desktopMock.desktop = false
    window.localStorage.clear()
    uiMocks.setActiveTab.mockReset()
    accessTokenMocks.notifyAuthRequired.mockReset()
    pwaMocks.requestPwaInstall.mockReset()
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
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    document.body.style.overflow = ''
    vi.restoreAllMocks()
  })

  it('lists the three onboarding steps on web', async () => {
    await renderDialog()

    expect(document.body.textContent).toContain('新手引导')
    expect(document.body.textContent).toContain('填写访问令牌')
    expect(document.body.textContent).toContain('创建第一个自动化任务')
    expect(document.body.textContent).toContain('安装为应用')
    expect(document.querySelectorAll('[role="dialog"] li')).toHaveLength(3)
  })

  it('skips the token step on desktop', async () => {
    desktopMock.desktop = true
    await renderDialog()

    expect(document.body.textContent).not.toContain('填写访问令牌')
    expect(document.body.textContent).toContain('创建第一个自动化任务')
    expect(document.body.textContent).toContain('使用桌面端')
    expect(document.querySelectorAll('[role="dialog"] li')).toHaveLength(2)
  })

  it('opens the token dialog, automation workspace, and install prompt from their steps', async () => {
    const firstClose = await renderDialog()

    await click('填写令牌')
    expect(accessTokenMocks.notifyAuthRequired).toHaveBeenCalledOnce()
    expect(firstClose).toHaveBeenCalledOnce()

    const secondClose = await renderDialog()
    await click('打开自动化任务')
    expect(uiMocks.setActiveTab).toHaveBeenCalledWith('automation')
    expect(secondClose).toHaveBeenCalledOnce()

    const thirdClose = await renderDialog()
    await click('安装应用')
    expect(pwaMocks.requestPwaInstall).toHaveBeenCalledOnce()
    expect(thirdClose).toHaveBeenCalledOnce()
  })

  it('closes with the close button, Escape, or the overlay', async () => {
    const closeButton = await renderDialog()
    await click('关闭对话框')
    expect(closeButton).toHaveBeenCalledOnce()

    const escapeClose = await renderDialog()
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(escapeClose).toHaveBeenCalledOnce()

    const overlayClose = await renderDialog()
    await act(async () => {
      document.querySelector<HTMLElement>('.app-modal-backdrop')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(overlayClose).toHaveBeenCalledOnce()
  })

  it('stores a timestamp when the guide is marked as seen', () => {
    expect(hasSeenOnboarding()).toBe(false)

    markOnboardingSeen()

    const seenAt = Number(window.localStorage.getItem(ONBOARDING_SEEN_KEY))
    expect(seenAt).toBeGreaterThan(0)
    expect(hasSeenOnboarding()).toBe(true)
  })
})
