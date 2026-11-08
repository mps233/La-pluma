// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccessTokenGate from './AccessTokenGate'
import { ACCESS_TOKEN_STORAGE_KEY, AUTH_REQUIRED_EVENT } from '@/utils/accessToken'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
  })
}

const setInputValue = async (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}

describe('AccessTokenGate', () => {
  beforeEach(async () => {
    localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(<AccessTokenGate />))
    await flush()
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('opens on a 401 signal and saves the entered token', async () => {
    await act(async () => {
      window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT))
    })
    await flush()

    const dialog = document.querySelector('[role="alertdialog"]')
    expect(dialog?.textContent).toContain('需要访问令牌')

    const input = document.querySelector<HTMLInputElement>('input[placeholder="请输入访问令牌"]')!
    await setInputValue(input, 'phone-token')
    const save = Array.from(document.querySelectorAll('button'))
      .find(item => item.textContent?.trim() === '保存并重试')
    const reload = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    })
    await act(async () => save?.click())

    expect(localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBe('phone-token')
  })
})