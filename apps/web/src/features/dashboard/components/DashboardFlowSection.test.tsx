// @vitest-environment jsdom

import { Activity, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardFlowSection from './DashboardFlowSection'
import { usePreviewStore } from '@/features/device-mirror'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../hooks/useDashboardPreview', () => ({
  useDashboardPreview: () => ({
    videoRef: { current: null },
    fallbackSnapshot: null,
    showLivePreview: false,
    isConnecting: false,
    connectionState: 'off',
    statusText: '预览已关闭',
    headerStatusText: '预览已关闭',
    retry: vi.fn(),
    error: null,
    available: true,
  }),
}))

vi.mock('../hooks/useDashboardFlowLayout', () => ({
  useDashboardFlowLayout: () => ({
    flowGridRef: { current: null },
    flowCardRef: { current: null },
    flowPreviewRef: { current: null },
    flowGridStyle: undefined,
  }),
}))

vi.mock('./DashboardFlowPanel', () => ({ default: () => <div data-testid="flow-panel" /> }))

vi.mock('@/shared/components', () => ({
  SmoothPanel: ({
    children,
    className = '',
    surfaceClassName = '',
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & { surfaceClassName?: string }) => (
    <div className={`smooth-panel-shell ${className}`} {...props}>
      <div className={`smooth-panel-surface ${surfaceClassName}`}>{children}</div>
    </div>
  ),
}))

let container: HTMLDivElement
let root: Root

async function renderSection(mode: 'visible' | 'hidden', onOpenAutomation = vi.fn()) {
  await act(async () => {
    root.render(
      <Activity mode={mode}>
        <DashboardFlowSection refreshDashboard={async () => {}} onOpenAutomation={onOpenAutomation} />
      </Activity>,
    )
  })
  return onOpenAutomation
}

describe('DashboardFlowSection preview lifecycle', () => {
  beforeEach(() => {
    usePreviewStore.setState({ mode: 'off' })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('keeps the preview entry mounted across Activity visibility changes', async () => {
    await renderSection('visible')
    expect(container.querySelector('[data-testid="flow-panel"]')).not.toBeNull()
    expect(container.querySelector('[data-dashboard-preview-card]')).not.toBeNull()

    await renderSection('hidden')
    expect(container.querySelector('[data-dashboard-preview-card]')).not.toBeNull()

    await renderSection('visible')
    expect(container.querySelector('[data-dashboard-preview-card]')).not.toBeNull()
  })

  it('keeps the preview frame non-navigating while header modes stay interactive', async () => {
    const onOpenAutomation = await renderSection('visible')
    const frame = container.querySelector<HTMLElement>('[data-dashboard-preview-frame]')
    expect(frame).not.toBeNull()

    await act(async () => frame?.click())
    expect(onOpenAutomation).not.toHaveBeenCalled()

    const live = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
      .find(button => button.textContent === '实时')
    await act(async () => live?.click())

    expect(usePreviewStore.getState().mode).toBe('live')
    expect(onOpenAutomation).not.toHaveBeenCalled()
  })
})
