// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SlidersHorizontal } from 'lucide-react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Disclosure from './Disclosure'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

describe('Disclosure', () => {
  it('renders a native disclosure that toggles from its summary', async () => {
    await render(
      <Disclosure label="高级设置" meta="3 项" icon={<SlidersHorizontal />}>
        <button type="button">内部操作</button>
      </Disclosure>,
    )

    const details = container.querySelector('details')
    const summary = container.querySelector('summary')

    expect(details?.open).toBe(false)
    expect(summary?.textContent).toContain('高级设置')
    expect(summary?.textContent).toContain('3 项')
    expect(container.textContent).toContain('内部操作')

    await act(async () => {
      summary?.click()
    })
    expect(details?.open).toBe(true)

    await act(async () => {
      summary?.click()
    })
    expect(details?.open).toBe(false)
  })

  it('forwards native details attributes', async () => {
    await render(
      <Disclosure label="已完成" id="finished" open>
        内容
      </Disclosure>,
    )

    const details = container.querySelector('details')
    expect(details?.id).toBe('finished')
    expect(details?.open).toBe(true)
  })
})
