// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPanelStateStore } from '../model/panelState'
import type { CopilotSearchItem, ParadoxSearchResult } from '../types'
import CombatParadoxSearchPanel from './CombatParadoxSearchPanel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const copilot = (index: number, hotScore: number): CopilotSearchItem => ({
  id: String(index + 1),
  uri: `prts://${index + 1}`,
  views: 100 + index,
  hotScore,
})

const result = (hotScores: readonly number[]): ParadoxSearchResult => ({
  operator: '能天使',
  copilots: hotScores.map((hotScore, index) => copilot(index, hotScore)),
})

describe('CombatParadoxSearchPanel', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  const render = async (searchResult: ParadoxSearchResult) => {
    const root = createRoot(container)
    const onSelectUri = vi.fn()
    await act(async () => {
      root.render(
        <CombatParadoxSearchPanel
          nameStore={createPanelStateStore('能天使')}
          result={searchResult}
          searching={false}
          onSearch={vi.fn()}
          onCancel={vi.fn()}
          onSelectUri={onSelectUri}
        />,
      )
    })
    return {
      onSelectUri,
      rows: () => Array.from(container.querySelectorAll('button'))
        .filter(button => button.textContent?.includes('prts://')),
      unmount: async () => {
        await act(async () => root.unmount())
        container.remove()
      },
    }
  }

  it('renders every returned result instead of stopping at six', async () => {
    const panel = await render(result([9, 8, 7, 6, 5, 4, 3, 2]))

    expect(container.textContent).toContain('8 个作业')
    expect(panel.rows()).toHaveLength(8)
    for (let index = 1; index <= 8; index += 1) {
      expect(container.textContent).toContain(`prts://${index}`)
    }
    await panel.unmount()
  })

  it('shows the formatted hot score without inventing a star rating', async () => {
    const panel = await render(result([4.5, 16853.43055304006, Number.NaN, -1]))
    const rows = panel.rows()

    expect(rows[0]?.textContent).toMatch(/热度 4\.5(?!\d)/)
    expect(rows[1]?.textContent).toMatch(/热度 16853\.4(?!\d)/)
    expect(rows[2]?.textContent).toMatch(/热度 0(?!\d)/)
    expect(rows[3]?.textContent).toMatch(/热度 0(?!\d)/)
    expect(rows.every(row => row.querySelector('svg') === null)).toBe(true)
    await panel.unmount()
  })

  it('selects the clicked result by URI', async () => {
    const panel = await render(result([4.5]))

    await act(async () => panel.rows()[0]?.click())

    expect(panel.onSelectUri).toHaveBeenCalledWith('prts://1')
    await panel.unmount()
  })
})
