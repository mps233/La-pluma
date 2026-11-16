// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { CopilotDetailTarget } from '../model/copilotDetail'
import CombatCopilotDetailLayer from './CombatCopilotDetailLayer'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const richTarget: CopilotDetailTarget = {
  title: '第一关',
  stage: 'MAIN-1',
  stageId: 'main_01',
  apCost: 21,
  sourceLabel: '作业集 prts://s48990',
  uri: 'prts://101',
  presetFormation: true,
  supportsRaid: false,
  completedModes: ['normal', 'raid'],
  operators: [
    { name: '桃金娘', elite: 2, level: 60, skillLevel: 10, module: 'χ' },
    { name: '阿米娅', group: '输出组', elite: 2, level: 90 },
  ],
  groups: ['击杀组'],
  statusLabel: '待重试',
  error: '缺少干员：桃金娘\n请检查 box 后重试',
}

const minimalTarget: CopilotDetailTarget = {
  title: '作业 #9',
  sourceLabel: '作业链接',
}

describe('CombatCopilotDetailLayer', () => {
  let container: HTMLDivElement
  let root: Root
  let trigger: HTMLButtonElement
  let onClose: () => void
  let onCloseMock: Mock<() => void>

  const setViewport = (isMobile: boolean) => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: isMobile
        ? query === '(width < 640px)'
        : query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  }

  beforeEach(() => {
    setViewport(false)
    container = document.createElement('div')
    document.body.appendChild(container)
    trigger = document.createElement('button')
    trigger.textContent = '打开详情'
    document.body.appendChild(trigger)
    root = createRoot(container)
    onCloseMock = vi.fn<() => void>()
    onClose = onCloseMock
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    trigger.remove()
    document.body.style.overflow = ''
    vi.restoreAllMocks()
  })

  const flush = async () => {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
    })
  }

  const renderLayer = async (
    target: CopilotDetailTarget | null,
    loading = false,
    stacked = false,
  ) => {
    await act(async () => {
      root.render(
        <CombatCopilotDetailLayer
          target={target}
          loading={loading}
          onClose={onClose}
          stacked={stacked}
        />,
      )
    })
    await flush()
  }

  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')

  const copyButton = () => Array.from(dialog()?.querySelectorAll('button') ?? [])
    .find(button => button.textContent?.trim() === '复制链接') ?? null

  it('opens a non-modal desktop drawer, focuses it and returns focus on close', async () => {
    await renderLayer(null)
    trigger.focus()
    await renderLayer(richTarget)

    const panel = dialog()
    expect(panel).not.toBeNull()
    expect(panel?.getAttribute('aria-modal')).toBe('false')
    expect(document.getElementById(panel?.getAttribute('aria-labelledby') || '')?.textContent)
      .toBe('第一关')
    expect(document.activeElement).toBe(panel)
    expect(panel?.textContent).toContain('作业集 prts://s48990')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onCloseMock).toHaveBeenCalledOnce()

    await renderLayer(null)
    expect(document.activeElement).toBe(trigger)
  })

  it('renders the drawer shell with a loading state while the target is pending', async () => {
    trigger.focus()
    await renderLayer(null, true)

    const panel = dialog()
    expect(panel).not.toBeNull()
    expect(panel?.getAttribute('aria-modal')).toBe('false')
    expect(document.getElementById(panel?.getAttribute('aria-labelledby') || '')?.textContent)
      .toBe('作业详情')
    expect(panel?.querySelector('[role="status"]')?.textContent).toContain('正在加载作业')
    expect(document.activeElement).toBe(panel)

    await renderLayer(richTarget)
    const nextPanel = dialog()
    expect(document.getElementById(nextPanel?.getAttribute('aria-labelledby') || '')?.textContent)
      .toBe('第一关')
    expect(nextPanel?.querySelector('[role="status"]')).toBeNull()
  })

  it('renders nothing when neither a target nor a pending load exists', async () => {
    await renderLayer(null)

    expect(dialog()).toBeNull()
  })

  it('exposes modal semantics once the desktop drawer is stacked over another layer', async () => {
    await renderLayer(richTarget, false, true)

    expect(dialog()?.getAttribute('aria-modal')).toBe('true')
    expect(document.documentElement.hasAttribute('data-base-ui-scroll-locked')).toBe(true)
    expect(document.body.style.overflowY).toBe('hidden')
    expect(container.getAttribute('aria-hidden')).toBe('true')
  })

  it('keeps the desktop drawer non-modal while it is not stacked', async () => {
    await renderLayer(richTarget)
    const copy = copyButton()
    copy?.focus()

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(copy)
    expect(dialog()?.getAttribute('aria-modal')).toBe('false')
    expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull()
    expect(document.documentElement.hasAttribute('data-base-ui-scroll-locked')).toBe(false)
    expect(container.getAttribute('aria-hidden')).toBeNull()
  })

  it('closes on an outside press but keeps presses inside the drawer', async () => {
    await renderLayer(richTarget)

    dialog()?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(onCloseMock).not.toHaveBeenCalled()

    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(onCloseMock).toHaveBeenCalledOnce()
  })

  it('also closes on a plain mouse press outside the drawer', async () => {
    await renderLayer(richTarget)

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(onCloseMock).toHaveBeenCalledOnce()
  })

  it('renders the stage, AP, formation, raid, completion, failure and operator facts', async () => {
    await renderLayer(richTarget)

    const text = dialog()?.textContent ?? ''
    expect(text).toContain('MAIN-1')
    expect(text).toContain('main_01')
    expect(text).toContain('理智')
    expect(text).toContain('21')
    expect(text).toContain('预设编队 · 仅普通')
    expect(text).toContain('不支持突袭')
    expect(text).toContain('普通已完成')
    expect(text).toContain('突袭已完成')
    expect(text).toContain('待重试')
    expect(text).toContain('失败原因')
    expect(text).toContain('缺少干员：桃金娘\n请检查 box 后重试')
    expect(text).toContain('干员需求')
    expect(text).toContain('桃金娘')
    expect(text).toContain('精英 2')
    expect(text).toContain('等级 60')
    expect(text).toContain('技能 10')
    expect(text).toContain('模组 χ')
    expect(text).toContain('输出组')
    expect(text).toContain('阿米娅')
    expect(text).toContain('干员组')
    expect(text).toContain('击杀组')
    expect(text).toContain('复制链接')
  })

  it('does not render facts the target does not provide', async () => {
    await renderLayer(minimalTarget)

    const text = dialog()?.textContent ?? ''
    expect(text).toContain('作业 #9')
    expect(text).toContain('作业链接')
    expect(text).not.toContain('理智')
    expect(text).not.toContain('编队')
    expect(text).not.toContain('突袭')
    expect(text).not.toContain('失败原因')
    expect(text).not.toContain('干员需求')
    expect(text).not.toContain('作业描述')
    expect(text).not.toContain('完成模式')
  })

  it('shows the author description with line breaks and a safe external link', async () => {
    await renderLayer({
      ...richTarget,
      details: '作者：緊急失控\nhttps://www.bilibili.com/video/BV1FrWJ6nESh',
    })

    const text = dialog()?.textContent ?? ''
    expect(text).toContain('作业描述')
    expect(text).toContain('作者：緊急失控')

    const links = Array.from(dialog()?.querySelectorAll('a') ?? [])
    const video = links.find(link => link.textContent?.includes('BV1FrWJ6nESh'))
    expect(video?.getAttribute('href')).toBe('https://www.bilibili.com/video/BV1FrWJ6nESh')
    expect(video?.getAttribute('target')).toBe('_blank')
    expect(video?.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('copies the job link from the detail panel', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    await renderLayer(richTarget)

    const copy = Array.from(document.querySelectorAll('button'))
      .find(button => button.textContent?.trim() === '复制链接')
    expect(copy).not.toBeUndefined()
    await act(async () => {
      copy?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(writeText).toHaveBeenCalledWith('prts://101')
  })

  it('opens a modal bottom sheet with the modal focus contract below 640px', async () => {
    setViewport(true)
    trigger.focus()
    await renderLayer(richTarget)

    const sheet = dialog()
    expect(sheet).not.toBeNull()
    expect(sheet?.id).toBe('combat-copilot-detail-panel')
    expect(sheet?.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(sheet?.getAttribute('aria-labelledby') || '')?.textContent)
      .toBe('第一关')
    expect(container.getAttribute('aria-hidden')).toBe('true')
    expect(document.documentElement.hasAttribute('data-base-ui-scroll-locked')).toBe(true)
    expect(document.body.style.overflowY).toBe('hidden')
    expect(document.querySelector('[data-slot="sheet-overlay"]')).not.toBeNull()
    expect(sheet?.getAttribute('data-side')).toBe('bottom')
    expect(sheet?.textContent).toContain('缺少干员：桃金娘')
  })
})
