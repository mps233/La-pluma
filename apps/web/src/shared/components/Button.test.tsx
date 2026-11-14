// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LoaderCircle } from 'lucide-react'
import { Button } from '@/shared/ui/button'

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

async function renderButton(jsx: React.ReactNode) {
  await act(async () => root.render(jsx))
  return container.querySelector<HTMLButtonElement>('button')
}

function LoadingButton({
  loading,
  loadingLabel,
  onExecute,
  children,
}: {
  loading: boolean
  loadingLabel: string
  onExecute: () => void
  children: string
}) {
  return (
    <Button disabled={loading} aria-busy={loading || undefined} onClick={onExecute}>
      {loading
        ? <><LoaderCircle aria-hidden="true" />{loadingLabel}</>
        : children}
    </Button>
  )
}

describe('Button consumption contract', () => {
  it('shows the loading label, exposes busy state, and blocks clicks while loading', async () => {
    const onExecute = vi.fn()
    const button = await renderButton(
      <LoadingButton loading loadingLabel="执行中" onExecute={onExecute}>立即执行</LoadingButton>,
    )

    expect(button?.disabled).toBe(true)
    expect(button?.getAttribute('aria-busy')).toBe('true')
    expect(button?.textContent).toContain('执行中')
    expect(button?.textContent).not.toContain('立即执行')

    await act(async () => button?.click())
    expect(onExecute).not.toHaveBeenCalled()
  })

  it('renders the action label and fires clicks when enabled', async () => {
    const onExecute = vi.fn()
    const button = await renderButton(
      <LoadingButton loading={false} loadingLabel="执行中" onExecute={onExecute}>立即执行</LoadingButton>,
    )

    expect(button?.disabled).toBe(false)
    expect(button?.getAttribute('aria-busy')).toBeNull()
    expect(button?.textContent).toContain('立即执行')

    await act(async () => button?.click())
    expect(onExecute).toHaveBeenCalledOnce()
  })

  it('passes through descriptive DOM attributes such as the run status key', async () => {
    const button = await renderButton(
      <Button data-status-key="ready" aria-pressed={false} title="立即执行">立即执行</Button>,
    )

    expect(button?.getAttribute('data-status-key')).toBe('ready')
    expect(button?.getAttribute('aria-pressed')).toBe('false')
    expect(button?.getAttribute('title')).toBe('立即执行')
  })
})
