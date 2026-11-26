// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useDashboardStore } from '../store/dashboardStore'
import DashboardDeviceSection from './DashboardDeviceSection'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  useDashboardStore.setState({
    deviceStats: {
      cpuPct: 42,
      load1m: 0.8,
      memPct: 78,
      memUsed: '8 GB',
      memTotal: '16 GB',
      diskPct: 91,
      diskUsed: '400 GB',
      diskTotal: '512 GB',
      temp: 45,
    },
    temperatureHistory: [44, 45],
  })
  await act(async () => {
    root.render(<DashboardDeviceSection />)
  })
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  useDashboardStore.setState({ deviceStats: null, temperatureHistory: [] })
})

describe('DashboardDeviceSection', () => {
  it('exposes each usage bar as a named progressbar with value and max', () => {
    const bars = Array.from(container.querySelectorAll<HTMLElement>('[role="progressbar"]'))

    expect(bars.map(bar => bar.getAttribute('aria-label'))).toEqual([
      'CPU使用率',
      '内存使用率',
      '磁盘使用率',
    ])
    expect(bars.map(bar => bar.getAttribute('aria-valuenow'))).toEqual(['42', '78', '91'])
    expect(bars.every(bar => bar.getAttribute('aria-valuemax') === '100')).toBe(true)
  })
})
