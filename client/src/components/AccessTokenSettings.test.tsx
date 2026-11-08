// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import AccessTokenSettings from './AccessTokenSettings'
import { ACCESS_TOKEN_STORAGE_KEY } from '@/utils/accessToken'

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

const button = (label: string) => Array.from(container.querySelectorAll('button'))
  .find(item => item.textContent?.trim() === label)

describe('AccessTokenSettings', () => {
  beforeEach(async () => {
    localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(<AccessTokenSettings />))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('saves and clears a token in local storage', async () => {
    const input = container.querySelector<HTMLInputElement>('input[placeholder="请输入访问令牌"]')!
    await setInputValue(input, 'phone-token')
    await act(async () => button('保存令牌')?.click())

    expect(localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBe('phone-token')
    expect(container.textContent).toContain('已设置')

    await act(async () => button('清除令牌')?.click())
    expect(localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBeNull()
    expect(container.textContent).toContain('未设置')
  })
})