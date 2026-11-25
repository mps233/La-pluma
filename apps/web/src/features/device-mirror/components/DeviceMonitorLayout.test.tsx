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
  it('places standard page content beside one labelled monitor', async () => {
    await renderLayout(
      <DeviceMonitorLayout variant="standard">
        <p>标准内容</p>
      </DeviceMonitorLayout>,
    )

    expect(container.querySelector('[data-device-monitor-layout="standard"]')).not.toBeNull()
    expect(container.querySelector('[data-monitor-area="main"]')?.textContent).toContain('标准内容')
    expect(container.querySelector('[data-monitor-area="monitor"]')?.getAttribute('aria-label')).toBe('设备画面')
    expect(container.querySelectorAll('[data-region="monitor"]')).toHaveLength(1)
  })

  it('keeps standard support content in the monitor column', async () => {
    await renderLayout(
      <DeviceMonitorLayout
        variant="standard"
        support={<div data-testid="support-content">设置内容</div>}
      >
        <p>标准内容</p>
      </DeviceMonitorLayout>,
    )

    const support = container.querySelector('[data-monitor-area="support"]')
    expect(support?.textContent).toContain('设置内容')
    expect(support?.querySelector('[data-monitor-area="monitor"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-region="monitor"]')).toHaveLength(1)
  })

  it('renders workbench areas with a labelled monitor in the support column', async () => {
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

    expect(container.querySelector('[data-device-monitor-layout="workbench"]')).not.toBeNull()
    expect(container.querySelector('[data-monitor-area="sequence"]')?.textContent).toContain('流程内容')
    expect(container.querySelector('[data-monitor-area="editor"]')?.textContent).toContain('配置内容')
    expect(container.querySelector('[data-monitor-area="support"]')?.textContent).toContain('定时内容')
    expect(container.querySelector('[data-monitor-area="support"]')?.textContent).toContain('通知内容')
    expect(container.querySelector('[data-monitor-area="monitor"]')?.getAttribute('aria-label')).toBe('设备画面')
    expect(container.querySelectorAll('[data-region="monitor"]')).toHaveLength(1)
  })

  it('renders mode areas as direct grid children with one monitor', async () => {
    await renderLayout(
      <DeviceMonitorLayout
        variant="mode"
        mode={<div data-monitor-area="mode">模式内容</div>}
        content={<div data-testid="mode-content">视图内容</div>}
      />,
    )

    expect(container.querySelector('[data-device-monitor-layout="mode"]')).not.toBeNull()
    expect(container.querySelector('[data-monitor-area="mode"]')?.textContent).toContain('模式内容')
    expect(container.querySelector('[data-testid="mode-content"]')?.textContent).toContain('视图内容')
    expect(container.querySelector('[data-monitor-area="monitor"]')?.getAttribute('aria-label')).toBe('设备画面')
    expect(container.querySelectorAll('[data-region="monitor"]')).toHaveLength(1)
  })
})
