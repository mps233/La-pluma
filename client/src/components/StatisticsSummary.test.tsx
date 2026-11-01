// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import StatisticsSummary from './StatisticsSummary'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

describe('StatisticsSummary readout band', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('renders one measured headline, a ledger, and provenance without its own surface', async () => {
    await act(async () => root.render(
      <StatisticsSummary
        ariaLabel="测试数据概览"
        primary={{
          label: '收集率',
          value: 88,
          unit: '%',
          detail: '409 / 463 已收录',
          meter: 88,
          meterLabel: '测试收集率',
          meterText: '88%，已拥有 409 位，共 463 位',
        }}
        stats={[
          { label: '已拥有', value: '409', unit: '位' },
          { label: '理智药', value: '0', unit: '瓶', muted: true },
        ]}
        meta={[
          { label: '更新于', value: '2026/11/01 05:09' },
          { label: '库存最多', value: '龙门币' },
        ]}
      />,
    ))

    const band = container.querySelector('.data-readout')
    expect(band?.getAttribute('aria-label')).toBe('测试数据概览')
    expect(band?.classList.contains('surface-soft')).toBe(false)
    expect(band?.classList.contains('border')).toBe(false)

    expect(container.querySelector('.data-readout-primary .data-readout-label')?.textContent).toBe('收集率')
    expect(container.querySelector('.data-readout-primary .data-readout-number')?.textContent).toBe('88')
    expect(container.querySelector('.data-readout-primary .data-readout-unit')?.textContent).toBe('%')
    expect(container.querySelector('.data-readout-detail')?.textContent).toBe('409 / 463 已收录')

    const meter = container.querySelector('[role="progressbar"]')
    expect(meter?.getAttribute('aria-label')).toBe('测试收集率')
    expect(meter?.getAttribute('aria-valuenow')).toBe('88')
    expect(meter?.getAttribute('aria-valuetext')).toBe('88%，已拥有 409 位，共 463 位')

    const rows = Array.from(container.querySelectorAll('.data-readout-stat'))
    expect(rows).toHaveLength(2)
    expect(rows[1]?.classList.contains('is-muted')).toBe(true)
    expect(rows[1]?.querySelector('.data-readout-unit')?.textContent).toBe('瓶')
    expect(container.querySelectorAll('.data-readout-meta > span')).toHaveLength(2)
    expect(container.textContent).toContain('更新于 2026/11/01 05:09')
  })

  it('omits the meter when there is no real measurement', async () => {
    await act(async () => root.render(
      <StatisticsSummary
        ariaLabel="仓库数据概览"
        primary={{ label: '库存总量', value: '20,048,443', unit: '件', detail: '含货币与经验道具' }}
        stats={[{ label: '物品种类', value: '82', unit: '种' }]}
      />,
    ))

    expect(container.querySelector('[role="progressbar"]')).toBeNull()
    expect(container.querySelector('.data-readout-meta')).toBeNull()
    expect(container.textContent).toContain('含货币与经验道具')
  })
})
