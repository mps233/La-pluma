// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CopilotSearchItem } from '../types'
import CombatCopilotDiscoveryCard from './CombatCopilotDiscoveryCard'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ITEM: CopilotSearchItem = {
  id: '1',
  uri: 'prts://1',
  views: 1200,
  hotScore: 98,
  stageCode: '1-7',
  stageLabel: '暴君',
  title: '突袭 1-7 挂机',
  uploader: '博士A',
  uploadTime: new Date(2026, 2, 4, 12).toISOString(),
  operators: ['阿米娅', '陈'],
  match: { mode: 'ready', missing: [], training: [], check: [], totalSlots: 2 },
}

const renderCard = async (overrides: Partial<CopilotSearchItem> = {}) => {
  const onPreview = vi.fn()
  const onAddToQueue = vi.fn()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <CombatCopilotDiscoveryCard
        item={{ ...ITEM, ...overrides }}
        view="grid"
        recommended={false}
        adding={false}
        matchEnabled
        ownedOperatorNames={new Set(['阿米娅'])}
        onPreview={onPreview}
        onAddToQueue={onAddToQueue}
      />,
    )
  })
  return {
    container,
    root,
    onPreview,
    onAddToQueue,
    unmount: async () => {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}

const click = async (element: Element | null) => {
  expect(element).not.toBeNull()
  await act(async () => {
    ;(element as HTMLElement).click()
  })
}

describe('CombatCopilotDiscoveryCard', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('opens the preview when the card background is clicked', async () => {
    const card = await renderCard()

    await click(card.container.querySelector('article'))

    expect(card.onPreview).toHaveBeenCalledOnce()
    expect(card.onPreview).toHaveBeenCalledWith('prts://1')
    expect(card.onAddToQueue).not.toHaveBeenCalled()
    await card.unmount()
  })

  it('opens the preview from the card text without double-firing', async () => {
    const card = await renderCard()

    const titleText = Array.from(card.container.querySelectorAll<HTMLElement>('span'))
      .find(node => node.textContent === '突袭 1-7 挂机')
    await click(titleText ?? null)

    expect(card.onPreview).toHaveBeenCalledOnce()
    await card.unmount()
  })

  it('keeps the queue action from opening the preview', async () => {
    const card = await renderCard()

    const queueButton = Array.from(card.container.querySelectorAll('button'))
      .find(button => button.getAttribute('aria-label') === '加入队列: 突袭 1-7 挂机')
    await click(queueButton ?? null)

    expect(card.onAddToQueue).toHaveBeenCalledWith('prts://1')
    expect(card.onPreview).not.toHaveBeenCalled()
    await card.unmount()
  })

  it('labels owned and missing operators in the card chips', async () => {
    const card = await renderCard()

    const cardMain = card.container.querySelector('button[aria-label="查看作业 突袭 1-7 挂机"]')
    const chips = Array.from(cardMain?.querySelectorAll<HTMLElement>('[title]') ?? [])
    expect(chips.map(chip => chip.textContent)).toEqual(['阿米娅', '陈'])
    expect(chips.map(chip => chip.getAttribute('title'))).toEqual(['阿米娅（已拥有）', '陈（未拥有）'])
    await card.unmount()
  })
})
