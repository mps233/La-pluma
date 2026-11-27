// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

vi.mock('@/state', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/state')>()),
  useUIStore: (selector: (state: { setActiveTab: typeof uiMocks.setActiveTab }) => unknown) =>
    selector({ setActiveTab: uiMocks.setActiveTab }),
}))

vi.mock('@/utils/accessToken', () => ({
  notifyAuthRequired: accessTokenMocks.notifyAuthRequired,
}))

vi.mock('@/utils/pwaInstallPrompt', () => ({
  requestPwaInstall: pwaMocks.requestPwaInstall,
}))

afterEach(cleanup)

const renderDialog = (isOpen = true, onClose = vi.fn()) => {
  const result = render(<OnboardingDialog isOpen={isOpen} onClose={onClose} />)
  return { onClose, ...result }
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
  })

  afterEach(() => {
    cleanup()
    document.body.style.overflow = ''
    vi.restoreAllMocks()
  })

  it('lists the three onboarding steps on web', () => {
    renderDialog()

    expect(document.body.textContent).toContain('新手引导')
    expect(document.body.textContent).toContain('填写访问令牌')
    expect(document.body.textContent).toContain('创建第一个自动化任务')
    expect(document.body.textContent).toContain('安装为应用')
    expect(within(screen.getByRole('dialog')).getAllByRole('listitem')).toHaveLength(3)
  })

  it('skips the token step on desktop', () => {
    desktopMock.desktop = true
    renderDialog()

    expect(document.body.textContent).not.toContain('填写访问令牌')
    expect(document.body.textContent).toContain('创建第一个自动化任务')
    expect(document.body.textContent).toContain('使用桌面端')
    expect(within(screen.getByRole('dialog')).getAllByRole('listitem')).toHaveLength(2)
  })

  it('opens the token dialog, automation workspace, and install prompt from their steps', async () => {
    const user = userEvent.setup()
    const first = renderDialog()

    await user.click(screen.getByRole('button', { name: '填写令牌' }))
    expect(accessTokenMocks.notifyAuthRequired).toHaveBeenCalledOnce()
    expect(first.onClose).toHaveBeenCalledOnce()
    first.unmount()

    const second = renderDialog()
    await user.click(screen.getByRole('button', { name: '打开自动化任务' }))
    expect(uiMocks.setActiveTab).toHaveBeenCalledWith('automation')
    expect(second.onClose).toHaveBeenCalledOnce()
    second.unmount()

    const third = renderDialog()
    await user.click(screen.getByRole('button', { name: '安装应用' }))
    expect(pwaMocks.requestPwaInstall).toHaveBeenCalledOnce()
    expect(third.onClose).toHaveBeenCalledOnce()
  })

  it('closes with the close button, Escape, or the overlay', async () => {
    const user = userEvent.setup()
    const closeButton = renderDialog()
    await user.click(screen.getByRole('button', { name: '关闭对话框' }))
    expect(closeButton.onClose).toHaveBeenCalledOnce()
    closeButton.unmount()

    const escapeClose = renderDialog()
    fireEvent.keyDown(document, { key: 'Escape', bubbles: true })
    expect(escapeClose.onClose).toHaveBeenCalledOnce()
    escapeClose.unmount()

    const overlayClose = renderDialog()
    fireEvent.click(document.querySelector<HTMLElement>('.app-modal-backdrop')!)
    expect(overlayClose.onClose).toHaveBeenCalledOnce()
  })

  it('stores a timestamp when the guide is marked as seen', () => {
    expect(hasSeenOnboarding()).toBe(false)

    markOnboardingSeen()

    const seenAt = Number(window.localStorage.getItem(ONBOARDING_SEEN_KEY))
    expect(seenAt).toBeGreaterThan(0)
    expect(hasSeenOnboarding()).toBe(true)
  })
})
