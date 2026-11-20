// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from '@/shared/ui/button'
import {
  DialogBody,
  DialogFrame,
  DialogFrameFooter,
  type DialogFrameProps,
} from './DialogFrame'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const flush = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 20))
  })
}

const buttonByLabel = (label: string) => {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .find(candidate => candidate.getAttribute('aria-label') === label)
  expect(button).toBeDefined()
  return button as HTMLButtonElement
}

const buttonByText = (label: string) => {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .find(candidate => candidate.textContent?.trim() === label)
  expect(button).toBeDefined()
  return button as HTMLButtonElement
}

const click = async (element: HTMLElement) => {
  await act(async () => {
    element.click()
  })
  await flush()
}

interface TestDialogProps extends Partial<Omit<DialogFrameProps, 'open' | 'title' | 'children'>> {
  onFooterAction?: () => void
}

function TestDialog({
  onOpenChange,
  closeDisabled = false,
  description,
  onFooterAction = vi.fn(),
  footer,
  toolbar,
}: TestDialogProps) {
  const [open, setOpen] = useState(true)
  return (
    <DialogFrame
      open={open}
      onOpenChange={next => {
        onOpenChange?.(next)
        setOpen(next)
      }}
      title="测试对话框"
      description={description}
      closeDisabled={closeDisabled}
      toolbar={toolbar}
      footer={footer ?? (
        <DialogFrameFooter>
          <Button onClick={onFooterAction}>完成</Button>
        </DialogFrameFooter>
      )}
    >
      <DialogBody>
        <p>对话框内容</p>
      </DialogBody>
    </DialogFrame>
  )
}

const renderDialog = async (props: TestDialogProps = {}) => {
  await act(async () => {
    root.render(<TestDialog {...props} />)
  })
  await flush()
}

describe('DialogFrame', () => {
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

  it('exposes the title and description as accessible dialog metadata', async () => {
    await renderDialog({ description: '用于编辑排班' })

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(dialog?.getAttribute('aria-labelledby') || '')?.textContent)
      .toBe('测试对话框')
    expect(document.getElementById(dialog?.getAttribute('aria-describedby') || '')?.textContent)
      .toBe('用于编辑排班')
  })

  it('renders the toolbar between the header and the scrollable body', async () => {
    await renderDialog({ toolbar: <div>对话框工具栏</div> })

    const dialog = document.querySelector<HTMLElement>('[data-slot="dialog-content"]')
    expect(dialog).not.toBeNull()
    const header = dialog!.querySelector('[data-slot="dialog-header"]')
    const toolbar = dialog!.querySelector('[data-slot="dialog-toolbar"]')
    const body = dialog!.querySelector('[data-slot="dialog-body"]')
    expect(toolbar).not.toBeNull()
    expect(toolbar?.textContent).toContain('对话框工具栏')
    expect(header?.nextElementSibling).toBe(toolbar)
    expect(toolbar?.nextElementSibling).toBe(body)
  })

  it('omits the toolbar slot when no toolbar is provided', async () => {
    await renderDialog()

    expect(document.querySelector('[data-slot="dialog-toolbar"]')).toBeNull()
  })

  it('closes from the header close button', async () => {
    const onOpenChange = vi.fn()
    await renderDialog({ onOpenChange })

    await click(buttonByLabel('关闭对话框'))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('keeps the dialog open while closing is disabled', async () => {
    const onOpenChange = vi.fn()
    await renderDialog({ closeDisabled: true, onOpenChange })

    const closeButton = buttonByLabel('关闭对话框')
    expect(closeButton.disabled).toBe(true)
    await click(closeButton)
    expect(onOpenChange).not.toHaveBeenCalled()

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await flush()

    expect(onOpenChange).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('closes on an outside press unless closing is disabled', async () => {
    const onOpenChange = vi.fn()
    await renderDialog({ onOpenChange })

    await act(async () => {
      document.querySelector('[data-slot="dialog-overlay"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('does not close on an outside press while closing is disabled', async () => {
    const onOpenChange = vi.fn()
    await renderDialog({ closeDisabled: true, onOpenChange })

    await act(async () => {
      document.querySelector('[data-slot="dialog-overlay"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()

    expect(onOpenChange).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('forwards scroll events from the scrollable body', async () => {
    const onScroll = vi.fn()
    await act(async () => {
      root.render(
        <DialogFrame open onOpenChange={vi.fn()} title="测试对话框">
          <DialogBody onScroll={onScroll}>
            <p>可滚动内容</p>
          </DialogBody>
        </DialogFrame>,
      )
    })
    await flush()

    const body = document.querySelector('[data-slot="dialog-body"]')
    expect(body).not.toBeNull()
    await act(async () => {
      body!.dispatchEvent(new Event('scroll'))
    })

    expect(onScroll).toHaveBeenCalledOnce()
  })

  it('renders footer actions', async () => {
    const onFooterAction = vi.fn()
    await renderDialog({ onFooterAction })

    await click(buttonByText('完成'))

    expect(onFooterAction).toHaveBeenCalledOnce()
  })
})
