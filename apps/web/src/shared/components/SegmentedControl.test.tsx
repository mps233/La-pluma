// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SegmentedControl } from './SegmentedControl'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type DemoValue = 'auto' | 'on' | 'off'

const options = [
  { value: 'auto', label: '自动决定' },
  { value: 'on', label: '自动编队' },
  { value: 'off', label: '保留当前编队', disabled: true },
] as const

function Harness({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState<DemoValue>('auto')
  return (
    <SegmentedControl
      ariaLabel="编队"
      value={value}
      options={options}
      onChange={setValue}
      disabled={disabled}
      fullWidth
    />
  )
}

let container: HTMLDivElement
let root: Root

const flush = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

const renderHarness = async (disabled = false) => {
  await act(async () => root.render(<Harness disabled={disabled} />))
  await flush()
}

const buttons = () => Array.from(container.querySelectorAll<HTMLButtonElement>('button'))

const button = (label: string) => buttons().find(candidate => candidate.textContent?.includes(label))

const click = async (element: HTMLElement) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await flush()
}

const pressed = () => buttons()
  .filter(candidate => candidate.getAttribute('aria-pressed') === 'true')
  .map(candidate => candidate.textContent)

describe('SegmentedControl', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('renders a single-select group with one pressed option', async () => {
    await renderHarness()

    expect(container.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('编队')
    expect(buttons()).toHaveLength(3)
    expect(pressed()).toEqual(['自动决定'])
    expect(button('保留当前编队')?.disabled).toBe(true)
  })

  it('replaces the pressed option on selection and cannot clear the selection', async () => {
    await renderHarness()

    await click(button('自动编队')!)
    expect(pressed()).toEqual(['自动编队'])

    await click(button('自动编队')!)
    expect(pressed()).toEqual(['自动编队'])
  })

  it('ignores disabled options and disabled groups', async () => {
    await renderHarness()

    await click(button('保留当前编队')!)
    expect(pressed()).toEqual(['自动决定'])

    await act(async () => root.unmount())
    root = createRoot(container)
    await renderHarness(true)
    expect(buttons().every(candidate => candidate.disabled)).toBe(true)
  })
})
