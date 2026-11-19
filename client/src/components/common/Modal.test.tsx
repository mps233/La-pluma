// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './Modal'

afterEach(cleanup)

describe('ConfirmDialog', () => {
  beforeEach(() => {
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
    document.body.style.overflow = ''
    vi.restoreAllMocks()
  })

  it('exposes alert-dialog semantics, isolates the page, and focuses the safe action', () => {
    const { container } = render(
      <ConfirmDialog
        isOpen
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="清空日志？"
        message="此操作无法撤销。"
      />,
    )

    const dialog = screen.getByRole('alertdialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(dialog.getAttribute('aria-labelledby') || '')?.textContent).toBe('清空日志？')
    expect(document.getElementById(dialog.getAttribute('aria-describedby') || '')?.textContent).toContain('此操作无法撤销。')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '取消' }))
    expect(container.inert).toBe(true)
    expect(container.getAttribute('aria-hidden')).toBe('true')
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('keeps keyboard focus inside the dialog and handles Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ConfirmDialog isOpen onClose={onClose} onConfirm={vi.fn()} />)

    const confirmButton = screen.getByRole('button', { name: '确认' })
    confirmButton.focus()
    await user.tab()
    expect(screen.getByRole('alertdialog').contains(document.activeElement)).toBe(true)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('waits for an asynchronous confirmation before closing', async () => {
    const user = userEvent.setup()
    let resolveConfirm: (() => void) | undefined
    const onConfirm = vi.fn(() => new Promise<void>(resolve => {
      resolveConfirm = resolve
    }))
    const onClose = vi.fn()

    render(<ConfirmDialog isOpen onClose={onClose} onConfirm={onConfirm} />)
    await user.click(screen.getByRole('button', { name: '确认' }))

    expect(onClose).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('处理中...')
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)

    await act(async () => resolveConfirm?.())
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('stays open and reports a failed confirmation', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <ConfirmDialog
        isOpen
        onClose={onClose}
        onConfirm={() => Promise.reject(new Error('清理失败，请稍后重试'))}
      />,
    )
    await user.click(screen.getByRole('button', { name: '确认' }))

    expect(onClose).not.toHaveBeenCalled()
    expect((await screen.findByRole('alert')).textContent).toContain('清理失败，请稍后重试')
  })
})
