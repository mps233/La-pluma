// @vitest-environment jsdom

import { act, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SearchField from './SearchField'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface HarnessProps {
  readonly clearable?: boolean
  readonly disabled?: boolean
  readonly onClear?: () => void
}

function Harness({ clearable = true, disabled = false, onClear }: HarnessProps) {
  const [value, setValue] = useState('')
  return (
    <div>
      <SearchField
        value={value}
        onValueChange={setValue}
        ariaLabel="搜索干员"
        placeholder="搜索干员"
        clearable={clearable}
        disabled={disabled}
        onClear={onClear}
      />
      <output>{value}</output>
    </div>
  )
}

async function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function input(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('input[aria-label="搜索干员"]')
}

function clearButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('button[aria-label="清除搜索"]')
}

let container: HTMLDivElement
let root: Root

async function render(node: ReactNode) {
  await act(async () => {
    root.render(node)
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
})

describe('SearchField', () => {
  it('reports typed text and clears back to an empty value', async () => {
    const onClear = vi.fn()
    await render(<Harness onClear={onClear} />)

    const field = input()
    expect(field).not.toBeNull()
    expect(clearButton()).toBeNull()

    await typeInto(field!, '能天使')
    expect(container.querySelector('output')?.textContent).toBe('能天使')
    expect(clearButton()).not.toBeNull()

    await act(async () => {
      clearButton()?.click()
    })

    expect(container.querySelector('output')?.textContent).toBe('')
    expect(input()?.value).toBe('')
    expect(document.activeElement).toBe(input())
    expect(onClear).toHaveBeenCalledTimes(1)
    expect(clearButton()).toBeNull()
  })

  it('only renders the clear control when opted in', async () => {
    await render(<Harness clearable={false} />)

    await typeInto(input()!, '德克萨斯')

    expect(container.querySelector('output')?.textContent).toBe('德克萨斯')
    expect(clearButton()).toBeNull()
  })

  it('forwards disabled state to the input', async () => {
    await render(<Harness disabled />)

    expect(input()?.disabled).toBe(true)
  })
})
