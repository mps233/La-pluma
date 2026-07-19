// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Input, { Select } from './Input'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

describe('common form controls', () => {
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

  it('associates an input label and validation error with the control', async () => {
    await act(async () => {
      root.render(
        <Input
          label="账号"
          value=""
          onChange={vi.fn()}
          error="请输入账号"
          aria-describedby="account-help"
        />,
      )
    })

    const input = container.querySelector('input')
    const label = container.querySelector('label')
    const error = container.querySelector('[role="alert"]')
    expect(input?.id).toBeTruthy()
    expect(label?.htmlFor).toBe(input?.id)
    expect(input?.getAttribute('aria-invalid')).toBe('true')
    expect(input?.getAttribute('aria-errormessage')).toBe(error?.id)
    expect(input?.getAttribute('aria-describedby')?.split(' ')).toEqual(['account-help', error?.id])
  })

  it('associates select guidance while preserving an explicit id', async () => {
    await act(async () => {
      root.render(
        <Select
          id="billing-cycle"
          label="计费周期"
          value="month"
          onChange={vi.fn()}
          hint="可随时切换"
          options={[{ value: 'month', label: '按月' }]}
        />,
      )
    })

    const select = container.querySelector('select')
    const hint = container.querySelector('p')
    expect(container.querySelector('label')?.htmlFor).toBe('billing-cycle')
    expect(select?.getAttribute('aria-describedby')).toBe(hint?.id)
    expect(hint?.textContent).toBe('可随时切换')
  })
})
