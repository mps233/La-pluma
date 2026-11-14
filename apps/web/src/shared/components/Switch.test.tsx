// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Switch } from '@/shared/ui/switch'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('Switch consumption contract', () => {
  function Host({ initial, disabled, onValue }: { initial: boolean; disabled?: boolean; onValue?: (value: boolean) => void }) {
    const [checked, setChecked] = useState(initial)
    return (
      <Switch
        checked={checked}
        disabled={disabled}
        aria-label="启用定时执行"
        onCheckedChange={next => {
          onValue?.(next)
          setChecked(next)
        }}
      />
    )
  }

  it('toggles from unchecked to checked and reports the next value', async () => {
    const values: boolean[] = []
    await act(async () => {
      root.render(<Host initial={false} onValue={value => values.push(value)} />)
    })

    const control = container.querySelector('[role="switch"]')
    expect(control?.getAttribute('aria-label')).toBe('启用定时执行')
    expect(control?.getAttribute('aria-checked')).toBe('false')

    await act(async () => (control as HTMLElement).click())
    expect(values).toEqual([true])
    expect(container.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true')

    await act(async () => (control as HTMLElement).click())
    expect(values).toEqual([true, false])
    expect(container.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
  })

  it('ignores interaction while disabled and keeps the current value', async () => {
    const values: boolean[] = []
    await act(async () => {
      root.render(<Host initial disabled onValue={value => values.push(value)} />)
    })

    const control = container.querySelector('[role="switch"]') as HTMLElement
    expect(control.getAttribute('aria-checked')).toBe('true')
    expect(control.getAttribute('aria-disabled')).toBe('true')

    await act(async () => control.click())
    expect(values).toEqual([])
    expect(control.getAttribute('aria-checked')).toBe('true')
  })
})
