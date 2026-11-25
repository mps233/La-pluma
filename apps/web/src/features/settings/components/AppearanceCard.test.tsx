// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppearanceCard from './AppearanceCard'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const setThemeId = vi.fn()

vi.mock('@/shared/theme/useTheme', () => ({
  useTheme: () => ({
    themeId: 'default',
    resolvedMode: 'light',
    setThemeId,
  }),
}))

vi.mock('@/shared/theme/registry', () => ({
  THEMES: [
    {
      id: 'default',
      name: '默认',
      description: 'shadcn 语义变量基线',
      swatches: [{ label: 'primary', light: '#007aff', dark: '#0a84ff' }],
    },
    {
      id: 'glass',
      name: '液态玻璃',
      description: '玻璃材质主题',
      swatches: [{ label: 'primary', light: '#007aff', dark: '#0a84ff' }],
    },
  ],
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  setThemeId.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('AppearanceCard', () => {
  it('selects a theme from the registry and keeps the current one pressed', async () => {
    await act(async () => root.render(<AppearanceCard />))

    const options = [...container.querySelectorAll<HTMLButtonElement>('button')]
    const current = options.find(option => option.textContent?.includes('默认'))
    const glass = options.find(option => option.textContent?.includes('液态玻璃'))

    expect(current?.getAttribute('aria-pressed')).toBe('true')
    expect(glass?.getAttribute('aria-pressed')).toBe('false')
    expect(current?.disabled).toBe(false)

    await act(async () => glass?.click())
    expect(setThemeId).toHaveBeenCalledWith('glass')
  })
})
