// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeviceMonitorLayout } from './DeviceMonitorPanel'

vi.mock('./ScreenMonitor', () => ({
  default: () => <div data-testid="screen-monitor" />,
}))

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

const renderLayout = async (node: ReactNode) => {
  await act(async () => root.render(node))
}

describe('DeviceMonitorLayout', () => {
  it('places standard page content beside a single monitor', async () => {
    await renderLayout(
      <DeviceMonitorLayout variant="standard">
        <p>标准内容</p>
      </DeviceMonitorLayout>,
    )

    const layout = container.querySelector('[data-device-monitor-layout="standard"]')
    expect(layout).not.toBeNull()
    expect(container.querySelectorAll('[data-region="monitor"]')).toHaveLength(1)
    expect(container.querySelector('[data-monitor-area="main"]')?.textContent).toContain('标准内容')
    expect(container.querySelector('[data-monitor-area="monitor"] [data-region="monitor"]')).not.toBeNull()
  })

  it('renders workbench areas and keeps the monitor at the top of the support column', async () => {
    await renderLayout(
      <DeviceMonitorLayout
        variant="workbench"
        sequence={<div data-monitor-area="sequence">流程内容</div>}
        editor={<div data-monitor-area="editor">配置内容</div>}
        support={(
          <>
            <div>定时内容</div>
            <div>通知内容</div>
          </>
        )}
      />,
    )

    const layout = container.querySelector('[data-device-monitor-layout="workbench"]')
    const support = container.querySelector('[data-monitor-area="support"]')
    expect(layout).not.toBeNull()
    expect(container.querySelectorAll('[data-region="monitor"]')).toHaveLength(1)
    expect(container.querySelector('[data-monitor-area="sequence"]')?.textContent).toContain('流程内容')
    expect(container.querySelector('[data-monitor-area="editor"]')?.textContent).toContain('配置内容')
    expect(support?.textContent).toContain('定时内容')
    expect(support?.textContent).toContain('通知内容')
    expect(support?.querySelector('[data-region="monitor"]')).not.toBeNull()
    expect(support?.firstElementChild?.querySelector('[data-region="monitor"]')).not.toBeNull()
    expect(container.querySelector('[data-monitor-area="sequence"]')?.parentElement).toBe(layout)
    expect(container.querySelector('[data-monitor-area="editor"]')?.parentElement).toBe(layout)
  })

  it('renders mode areas as direct grid children without wrapping the page content', async () => {
    await renderLayout(
      <DeviceMonitorLayout
        variant="mode"
        mode={<div data-monitor-area="mode">模式内容</div>}
        content={<div data-testid="mode-content">视图内容</div>}
      />,
    )

    const layout = container.querySelector('[data-device-monitor-layout="mode"]')
    const content = container.querySelector('[data-testid="mode-content"]')
    expect(layout).not.toBeNull()
    expect(container.querySelectorAll('[data-region="monitor"]')).toHaveLength(1)
    expect(container.querySelector('[data-monitor-area="mode"]')?.textContent).toContain('模式内容')
    expect(container.querySelector('[data-monitor-area="monitor"] [data-region="monitor"]')).not.toBeNull()
    expect(content?.parentElement).toBe(layout)
  })
})
