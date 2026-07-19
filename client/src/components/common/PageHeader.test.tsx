// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PageHeader from './PageHeader'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('framer-motion', () => ({
  motion: { div: 'div' },
  useReducedMotion: () => false,
}))

let container: HTMLDivElement
let root: Root

describe('PageHeader mobile layout', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('opts into a single mobile row without changing the default layout', async () => {
    await act(async () => root.render(
      <PageHeader title="控制台" actions={<button type="button">刷新</button>} mobileLayout="inline" />,
    ))
    expect(container.querySelector('.app-page-header')?.classList.contains('is-mobile-inline')).toBe(true)

    await act(async () => root.render(<PageHeader title="配置" actions={<button type="button">保存</button>} />))
    expect(container.querySelector('.app-page-header')?.classList.contains('is-mobile-inline')).toBe(false)
  })
})
