// @vitest-environment jsdom

import { act, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SegmentedTabs, SegmentedTabNav, SegmentedTabPanel } from './SegmentedTabs'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('framer-motion', async () => {
  const React = await import('react')
  type MotionTestProps = Record<string, unknown> & { children?: ReactNode }
  const MotionDiv = React.forwardRef<HTMLElement, MotionTestProps>(
    ({ children, initial: _initial, animate: _animate, transition: _transition, ...props }, ref) =>
      React.createElement('div', { ...props, ref }, children as ReactNode),
  )

  return { motion: { div: MotionDiv }, useReducedMotion: () => true }
})

type DemoValue = 'first' | 'second' | 'third'

const options = [
  { value: 'first', label: '第一' },
  { value: 'second', label: '第二' },
  { value: 'third', label: '第三' },
] as const

function Harness({
  keepMounted = false,
  disabled = false,
  onValueChange,
}: {
  keepMounted?: boolean
  disabled?: boolean
  onValueChange?: (value: DemoValue) => void
}) {
  const [value, setValue] = useState<DemoValue>('first')
  return (
    <SegmentedTabs
      value={value}
      onValueChange={(next) => {
        onValueChange?.(next)
        setValue(next)
      }}
    >
      <SegmentedTabNav
        ariaLabel="示例视图"
        value={value}
        options={options}
        disabled={disabled}
        tabId={item => `demo-tab-${item}`}
        panelId={item => (keepMounted || item === value ? `demo-panel-${item}` : undefined)}
      />
      <SegmentedTabPanel value="first" id="demo-panel-first" keepMounted={keepMounted}>
        <p>第一个面板</p>
        <input aria-label="第一面板草稿" />
      </SegmentedTabPanel>
      <SegmentedTabPanel value="second" id="demo-panel-second" keepMounted={keepMounted}>
        <p>第二个面板</p>
        <input aria-label="第二面板草稿" />
      </SegmentedTabPanel>
      <SegmentedTabPanel value="third" id="demo-panel-third" keepMounted={keepMounted}>
        <p>第三个面板</p>
      </SegmentedTabPanel>
    </SegmentedTabs>
  )
}

function GeneratedIdHarness() {
  const [value, setValue] = useState<DemoValue>('first')
  return (
    <SegmentedTabs value={value} onValueChange={setValue}>
      <SegmentedTabNav ariaLabel="生成 id 视图" value={value} options={options} />
      <SegmentedTabPanel value="first" keepMounted><p>第一个面板</p></SegmentedTabPanel>
      <SegmentedTabPanel value="second" keepMounted><p>第二个面板</p></SegmentedTabPanel>
      <SegmentedTabPanel value="third" keepMounted><p>第三个面板</p></SegmentedTabPanel>
    </SegmentedTabs>
  )
}

let container: HTMLDivElement
let root: Root

const flush = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

const renderHarness = async (
  keepMounted = false,
  onValueChange?: (value: DemoValue) => void,
  disabled = false,
) => {
  await act(async () => root.render(
    <Harness keepMounted={keepMounted} disabled={disabled} onValueChange={onValueChange} />,
  ))
  await flush()
}

const renderGeneratedIdHarness = async () => {
  await act(async () => root.render(<GeneratedIdHarness />))
  await flush()
}

const tab = (label: string) => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
  .find(candidate => candidate.textContent?.includes(label))

const panel = (value: DemoValue) => container.querySelector<HTMLElement>(`#demo-panel-${value}`)

const focus = async (element: HTMLElement) => {
  await act(async () => element.focus())
  await flush()
}

const keyDown = async (element: HTMLElement, key: string) => {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
  await flush()
}

const click = async (element: HTMLElement) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await flush()
}

const setInputValue = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}

const expectResolvableTabControls = () => {
  const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
  tabs.forEach((candidate) => {
    const controls = candidate.getAttribute('aria-controls')
    if (!controls) return
    const linkedPanel = document.getElementById(controls)
    expect(linkedPanel, `${candidate.id} 的 aria-controls`).not.toBeNull()
    expect(linkedPanel?.getAttribute('role')).toBe('tabpanel')
    expect(linkedPanel?.getAttribute('aria-labelledby')).toBe(candidate.id)
  })

  Array.from(container.querySelectorAll<HTMLElement>('[role="tabpanel"]')).forEach((linkedPanel) => {
    const labelledBy = linkedPanel.getAttribute('aria-labelledby')
    expect(labelledBy).not.toBeNull()
    expect(document.getElementById(labelledBy!)?.getAttribute('role')).toBe('tab')
  })
}

describe('SegmentedTabs', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    expectResolvableTabControls()
    await act(async () => root.unmount())
    container.remove()
  })

  it('links the tablist, tabs and active panel with stable ids', async () => {
    await renderHarness()

    expect(container.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('示例视图')
    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    expect(tabs).toHaveLength(3)
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true')
    expect(tabs[0]?.tabIndex).toBe(0)
    expect(tabs[1]?.tabIndex).toBe(-1)
    expect(tabs[0]?.id).toBe('demo-tab-first')
    expect(tabs[0]?.getAttribute('aria-controls')).toBe('demo-panel-first')

    const activePanel = container.querySelector<HTMLElement>('#demo-panel-first')
    expect(activePanel?.getAttribute('role')).toBe('tabpanel')
    expect(activePanel?.getAttribute('aria-labelledby')).toBe('demo-tab-first')
    expect(activePanel?.hasAttribute('hidden')).toBe(false)
    expect(panel('second')).toBeNull()
  })

  it('moves roving focus with arrow keys and Home/End without activating', async () => {
    await renderHarness()

    const first = tab('第一')!
    const second = tab('第二')!
    const third = tab('第三')!
    await focus(first)

    await keyDown(first, 'ArrowRight')
    expect(document.activeElement).toBe(second)
    expect(first.getAttribute('aria-selected')).toBe('true')
    expect(second.getAttribute('aria-selected')).toBe('false')

    await keyDown(second, 'End')
    expect(document.activeElement).toBe(third)
    expect(first.getAttribute('aria-selected')).toBe('true')

    await keyDown(third, 'Home')
    expect(document.activeElement).toBe(first)
    expect(first.getAttribute('aria-selected')).toBe('true')

    await keyDown(first, 'ArrowLeft')
    expect(document.activeElement).toBe(third)
    expect(first.getAttribute('aria-selected')).toBe('true')
  })

  it('activates exactly once when the browser click for Enter or Space is delivered', async () => {
    const onValueChange = vi.fn()
    await renderHarness(false, onValueChange)

    const first = tab('第一')!
    const second = tab('第二')!
    await focus(first)
    await keyDown(first, 'ArrowRight')
    expect(document.activeElement).toBe(second)

    await keyDown(second, 'Enter')
    await click(second)
    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenLastCalledWith('second')
    expect(second.getAttribute('aria-selected')).toBe('true')
    expect(panel('second')?.hasAttribute('hidden')).toBe(false)

    const third = tab('第三')!
    await keyDown(third, ' ')
    await click(third)
    expect(onValueChange).toHaveBeenCalledTimes(2)
    expect(onValueChange).toHaveBeenLastCalledWith('third')
    expect(third.getAttribute('aria-selected')).toBe('true')
    expect(panel('third')?.hasAttribute('hidden')).toBe(false)
  })

  it('keeps Base UI generated tab and panel ids when none are supplied', async () => {
    await renderGeneratedIdHarness()

    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    expect(tabs).toHaveLength(3)
    tabs.forEach((candidate) => {
      expect(candidate.id).not.toBe('')
      const controls = candidate.getAttribute('aria-controls')
      expect(controls).not.toBeNull()
      const linkedPanel = document.getElementById(controls!)
      expect(linkedPanel?.getAttribute('role')).toBe('tabpanel')
      expect(linkedPanel?.getAttribute('aria-labelledby')).toBe(candidate.id)
    })
  })

  it('removes an inactive panel when keepMounted is not set', async () => {
    await renderHarness()

    await click(tab('第二')!)
    expect(panel('first')).toBeNull()
    expect(panel('second')?.hasAttribute('hidden')).toBe(false)

    await click(tab('第一')!)
    expect(panel('second')).toBeNull()
  })

  it('keeps inactive panels mounted and preserves their local drafts', async () => {
    await renderHarness(true)

    expect(panel('second')?.hasAttribute('hidden')).toBe(true)
    expect(panel('third')?.hasAttribute('hidden')).toBe(true)

    await click(tab('第二')!)
    expect(panel('second')?.hasAttribute('hidden')).toBe(false)
    expect(panel('first')?.hasAttribute('hidden')).toBe(true)

    const draft = container.querySelector<HTMLInputElement>('input[aria-label="第二面板草稿"]')
    await setInputValue(draft!, '保留的草稿')

    await click(tab('第一')!)
    expect(panel('second')?.hasAttribute('hidden')).toBe(true)
    expect(panel('second')?.textContent).toContain('第二个面板')

    await click(tab('第二')!)
    expect(container.querySelector<HTMLInputElement>('input[aria-label="第二面板草稿"]')?.value)
      .toBe('保留的草稿')
  })

  it('disables every tab and rejects pointer and keyboard activation', async () => {
    const onValueChange = vi.fn()
    await renderHarness(false, onValueChange, true)

    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    expect(tabs).toHaveLength(3)
    expect(tabs.every(candidate => candidate.getAttribute('aria-disabled') === 'true')).toBe(true)

    const first = tab('第一')!
    const second = tab('第二')!
    await focus(first)
    await keyDown(first, 'ArrowRight')
    await keyDown(second, 'Enter')
    await click(second)

    expect(onValueChange).not.toHaveBeenCalled()
    expect(first.getAttribute('aria-selected')).toBe('true')
    expect(second.getAttribute('aria-selected')).toBe('false')
  })
})
