// @vitest-environment jsdom

import { act, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import NumberField from './NumberField'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface HarnessProps {
  readonly initial?: string
  readonly min?: number | string
  readonly max?: number | string
  readonly step?: number | string
  readonly disabled?: boolean
}

function Harness({ initial = '0', min, max, step, disabled = false }: HarnessProps) {
  const [value, setValue] = useState(initial)
  return (
    <div>
      <NumberField
        id="count"
        label="执行次数"
        value={value}
        onValueChange={setValue}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        placeholder="0"
      />
      <output>{value}</output>
    </div>
  )
}

function stepButton(name: '减少' | '增加'): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`button[aria-label="${name}执行次数"]`)
}

function currentValue(): string {
  return document.querySelector('output')?.textContent ?? ''
}

async function clickStep(name: '减少' | '增加') {
  await act(async () => {
    stepButton(name)?.click()
  })
}

async function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
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

describe('NumberField', () => {
  it('steps within bounds and disables the buttons at the limits', async () => {
    await render(<Harness initial="1" min={0} max={2} />)

    await clickStep('增加')
    expect(currentValue()).toBe('2')
    expect(stepButton('增加')?.disabled).toBe(true)

    await clickStep('减少')
    expect(currentValue()).toBe('1')
    expect(stepButton('增加')?.disabled).toBe(false)

    await clickStep('减少')
    expect(currentValue()).toBe('0')
    expect(stepButton('减少')?.disabled).toBe(true)
  })

  it('accepts string bounds and step size', async () => {
    await render(<Harness initial="0" min="0" max="5" step="5" />)

    await clickStep('增加')
    expect(currentValue()).toBe('5')
    expect(stepButton('增加')?.disabled).toBe(true)

    await clickStep('减少')
    expect(currentValue()).toBe('0')
    expect(stepButton('减少')?.disabled).toBe(true)
  })

  it('steps from an empty value and disables decreasing at zero', async () => {
    await render(<Harness initial="" min={0} />)

    expect(stepButton('减少')?.disabled).toBe(true)

    await clickStep('增加')
    expect(currentValue()).toBe('1')
  })

  it('disables the input and both step buttons when disabled', async () => {
    await render(<Harness initial="3" disabled />)

    const input = container.querySelector<HTMLInputElement>('input#count')
    expect(input?.disabled).toBe(true)
    expect(stepButton('减少')?.disabled).toBe(true)
    expect(stepButton('增加')?.disabled).toBe(true)
  })

  it('accepts typed values as the controlled source', async () => {
    await render(<Harness initial="3" />)

    const input = container.querySelector<HTMLInputElement>('input#count')
    await typeInto(input!, '7')
    expect(currentValue()).toBe('7')
  })
})
