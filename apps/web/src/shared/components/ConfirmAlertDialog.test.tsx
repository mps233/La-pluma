// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmAlertDialog } from './ConfirmAlertDialog'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const flush = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 20))
  })
}

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

const renderDialog = async (props: Partial<Parameters<typeof ConfirmAlertDialog>[0]> = {}) => {
  await act(async () => {
    root.render(
      <ConfirmAlertDialog
        isOpen
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="清空日志？"
        message="此操作无法撤销。"
        {...props}
      />,
    )
  })
  await flush()
}

describe('ConfirmAlertDialog', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('exposes alert-dialog semantics and focuses the cancel action', async () => {
    await renderDialog()

    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(dialog?.getAttribute('aria-labelledby') || '')?.textContent).toBe('清空日志？')
    expect(document.getElementById(dialog?.getAttribute('aria-describedby') || '')?.textContent)
      .toContain('此操作无法撤销。')
    expect(document.activeElement).toBe(getButton('取消'))
    expect(container.getAttribute('aria-hidden')).toBe('true')
    expect(document.body.style.overflowY).toBe('hidden')
  })

  it('waits for an asynchronous confirmation before closing', async () => {
    let resolveConfirm: (() => void) | undefined
    const onConfirm = vi.fn(() => new Promise<void>(resolve => {
      resolveConfirm = resolve
    }))
    const onClose = vi.fn()
    await renderDialog({ onConfirm, onClose })

    await clickButton('确认')

    expect(onClose).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('处理中...')
    expect(getButton('取消').disabled).toBe(true)

    await act(async () => resolveConfirm?.())
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('stays open when the confirmation resolves false', async () => {
    const onClose = vi.fn()
    await renderDialog({ onConfirm: () => false, onClose })

    await clickButton('确认')

    expect(onClose).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
  })

  it('stays open and reports a failed confirmation', async () => {
    const onClose = vi.fn()
    await renderDialog({
      onConfirm: () => Promise.reject(new Error('清理失败，请稍后重试')),
      onClose,
    })

    await clickButton('确认')

    expect(onClose).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('清理失败，请稍后重试')
  })

  it('closes on an outside press while idle but not while pending', async () => {
    let resolveConfirm: (() => void) | undefined
    const onClose = vi.fn()
    await renderDialog({
      onConfirm: () => new Promise<void>(resolve => {
        resolveConfirm = resolve
      }),
      onClose,
    })

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onClose).toHaveBeenCalledOnce()

    onClose.mockClear()
    await clickButton('确认')
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(onClose).not.toHaveBeenCalled()
    await act(async () => resolveConfirm?.())
  })

  it('does not close from Escape while the confirmation is pending', async () => {
    let resolveConfirm: (() => void) | undefined
    const onClose = vi.fn()
    await renderDialog({
      onConfirm: () => new Promise<void>(resolve => {
        resolveConfirm = resolve
      }),
      onClose,
    })

    await clickButton('确认')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(onClose).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()

    await act(async () => resolveConfirm?.())
  })
})
