// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import InlineAlert from './InlineAlert'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

async function render(node: ReactNode) {
  await act(async () => {
    root.render(node)
  })
}

function retryButton(): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find(button => button.textContent?.includes('重试')) ?? null
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

describe('InlineAlert', () => {
  it('announces title and body and runs the retry action', async () => {
    const onRetry = vi.fn()
    await render(
      <InlineAlert tone="warning" title="同步失败" onRetry={onRetry}>
        任务流程同步失败
      </InlineAlert>,
    )

    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('同步失败')
    expect(alert?.textContent).toContain('任务流程同步失败')

    await act(async () => {
      retryButton()?.click()
    })
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('disables the retry action while retrying', async () => {
    await render(
      <InlineAlert title="读取失败" onRetry={() => undefined} retrying>
        稍后再试
      </InlineAlert>,
    )

    const button = retryButton()
    expect(button?.disabled).toBe(true)
    expect(button?.getAttribute('aria-busy')).toBe('true')
    expect(button?.textContent).toContain('重试中')
  })

  it('renders a caller-provided action instead of the built-in retry', async () => {
    await render(
      <InlineAlert
        tone="info"
        title="需要更新"
        action={<a href="/settings">前往设置</a>}
      >
        当前版本过旧
      </InlineAlert>,
    )

    expect(container.querySelector('a[href="/settings"]')?.textContent).toBe('前往设置')
    expect(retryButton()).toBeNull()
  })
})
