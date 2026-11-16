// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Loading from './Loading'

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

describe('Loading', () => {
  it('announces itself as a polite busy status', async () => {
    await act(async () => root.render(<Loading />))

    const status = container.querySelector<HTMLElement>('[role="status"]')
    expect(status).not.toBeNull()
    expect(status?.getAttribute('aria-live')).toBe('polite')
    expect(status?.getAttribute('aria-busy')).toBe('true')
  })

  it('shows the provided text', async () => {
    await act(async () => root.render(<Loading text="正在读取运行数据" />))

    expect(container.textContent).toContain('正在读取运行数据')
  })

  it('falls back to the screen-reader loading label when no text is provided', async () => {
    await act(async () => root.render(<Loading />))

    const status = container.querySelector<HTMLElement>('[role="status"]')
    expect(status?.textContent).toBe('加载中')
  })
})
