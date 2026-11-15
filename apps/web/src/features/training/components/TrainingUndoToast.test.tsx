// @vitest-environment jsdom

import { StrictMode, act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TrainingUndoToast from './TrainingUndoToast'
import { AppToaster } from '@/shared/components'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let toasterContainer: HTMLDivElement
let toasterRoot: Root

const toast = () => document.querySelector<HTMLElement>('[data-sonner-toast]')

const renderToast = async (props: Partial<ComponentProps<typeof TrainingUndoToast>> = {}) => {
  await act(async () => root.render(
    <TrainingUndoToast
      name="阿米娅"
      pending={false}
      onUndo={vi.fn()}
      onDismiss={vi.fn()}
      {...props}
    />,
  ))
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
}

describe('training undo toast', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
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
    toasterContainer = document.createElement('div')
    document.body.appendChild(toasterContainer)
    toasterRoot = createRoot(toasterContainer)
    await act(async () => toasterRoot.render(<AppToaster />))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    await act(async () => toasterRoot.unmount())
    container.remove()
    toasterContainer.remove()
    vi.useRealTimers()
  })

  it('stays outside the page container and exposes a polite status', async () => {
    const onDismiss = vi.fn()
    await renderToast({ onDismiss })

    const element = toast()
    expect(element).not.toBeNull()
    expect(container.contains(element)).toBe(false)
    expect(element?.closest('section[aria-live="polite"]')).not.toBeNull()
    expect(element?.textContent).toContain('已移除 阿米娅')
    expect(element?.querySelector('button[aria-label="关闭移除提示"]')).not.toBeNull()

    await act(async () => { await vi.advanceTimersByTimeAsync(8000) })
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('pauses expiry while the pointer hovers the toast', async () => {
    const onDismiss = vi.fn()
    await renderToast({ onDismiss })

    await act(async () => {
      toast()!.closest('[data-sonner-toast]')!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(8000) })
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('pauses expiry while keyboard focus is inside and resumes after blur', async () => {
    const onDismiss = vi.fn()
    await renderToast({ onDismiss })

    const undoButton = Array.from(toast()!.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim() === '撤销')
    expect(undoButton).toBeDefined()

    await act(async () => undoButton!.focus())
    await act(async () => { await vi.advanceTimersByTimeAsync(8000) })
    expect(onDismiss).not.toHaveBeenCalled()

    await act(async () => undoButton!.blur())
    await act(async () => { await vi.advanceTimersByTimeAsync(8000) })
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('keeps the toast visible after a strict mode effect replay', async () => {
    await act(async () => root.render(
      <StrictMode>
        <TrainingUndoToast name="阿米娅" pending={false} onUndo={vi.fn()} onDismiss={vi.fn()} />
      </StrictMode>,
    ))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    expect(toast()).not.toBeNull()
  })

  it('does not expire while an undo request is pending', async () => {
    const onDismiss = vi.fn()
    await renderToast({ onDismiss, pending: true })

    await act(async () => { await vi.advanceTimersByTimeAsync(8000) })
    expect(onDismiss).not.toHaveBeenCalled()
    expect(toast()!.textContent).toContain('恢复中')
    expect(toast()!.querySelector<HTMLButtonElement>('button[aria-label="关闭移除提示"]')?.disabled).toBe(true)
  })
})
