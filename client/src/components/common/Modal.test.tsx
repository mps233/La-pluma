// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './Modal'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const getButton = (label: string) => {
  const button = Array.from(document.querySelectorAll('button'))
    .find(candidate => candidate.textContent?.includes(label))
  expect(button).toBeDefined()
  return button as HTMLButtonElement
}

const clickButton = async (label: string) => {
  const button = getButton(label)
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

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

  it('exposes alert-dialog semantics, isolates the page, and focuses the safe action', async () => {
    await act(async () => {
      root.render(
        <ConfirmDialog
          isOpen
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          title="清空日志？"
          message="此操作无法撤销。"
        />,
      )
    })

    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(dialog?.getAttribute('aria-labelledby') || '')?.textContent).toBe('清空日志？')
    expect(document.getElementById(dialog?.getAttribute('aria-describedby') || '')?.textContent).toContain('此操作无法撤销。')
    expect(document.activeElement).toBe(getButton('取消'))
    expect(container.inert).toBe(true)
    expect(container.getAttribute('aria-hidden')).toBe('true')
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('keeps keyboard focus inside the dialog and handles Escape', async () => {
    const onClose = vi.fn()
    await act(async () => {
      root.render(<ConfirmDialog isOpen onClose={onClose} onConfirm={vi.fn()} />)
    })

    const confirmButton = getButton('确认')
    confirmButton.focus()
    confirmButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.querySelector('[role="alertdialog"]')?.contains(document.activeElement)).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('waits for an asynchronous confirmation before closing', async () => {
    let resolveConfirm: (() => void) | undefined
    const onConfirm = vi.fn(() => new Promise<void>(resolve => {
      resolveConfirm = resolve
    }))
    const onClose = vi.fn()

    await act(async () => {
      root.render(<ConfirmDialog isOpen onClose={onClose} onConfirm={onConfirm} />)
    })
    await clickButton('确认')

    expect(onClose).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('处理中...')
    expect(getButton('取消').disabled).toBe(true)

    await act(async () => resolveConfirm?.())
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('stays open and reports a failed confirmation', async () => {
    const onClose = vi.fn()
    await act(async () => {
      root.render(
        <ConfirmDialog
          isOpen
          onClose={onClose}
          onConfirm={() => Promise.reject(new Error('清理失败，请稍后重试'))}
        />,
      )
    })
    await clickButton('确认')

    expect(onClose).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('清理失败，请稍后重试')
  })
})
