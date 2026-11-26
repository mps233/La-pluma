// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/shared/ui/tooltip'
import UnavailableAction from './UnavailableAction'

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

describe('UnavailableAction', () => {
  it('exposes a focusable wrapper named after the blocked action and its reason', async () => {
    await render(
      <TooltipProvider>
        <UnavailableAction action="开始" reason="自动化不可用">
          <button type="button" disabled>开始</button>
        </UnavailableAction>
      </TooltipProvider>,
    )

    const trigger = container.querySelector<HTMLElement>('[aria-label="开始：自动化不可用"]')
    expect(trigger).not.toBeNull()
    expect(trigger?.tabIndex).toBe(0)
    expect(trigger?.textContent).toBe('开始')
    expect(trigger?.querySelector('button')?.disabled).toBe(true)
  })
})
