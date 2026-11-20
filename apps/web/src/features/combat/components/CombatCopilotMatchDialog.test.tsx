// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_COPILOT_MATCH_MODES } from '../model/copilotDiscovery'
import CombatCopilotMatchDialog, { type CombatCopilotMatchDialogProps } from './CombatCopilotMatchDialog'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const installMatchMedia = () => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)',
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

const findButton = (name: string | RegExp): HTMLButtonElement => {
  const match = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => {
    const label = button.getAttribute('aria-label') ?? button.textContent?.trim() ?? ''
    return typeof name === 'string' ? label === name : name.test(label)
  })
  expect(match, `未找到按钮：${String(name)}`).toBeDefined()
  return match!
}

const checkboxByLabel = (label: string): HTMLElement => {
  const match = Array.from(document.querySelectorAll('[role="checkbox"]'))
    .find(checkbox => checkbox.closest('label')?.textContent?.replace(/\s+/g, ' ').trim() === label)
  expect(match, `未找到复选框：${label}`).toBeDefined()
  return match as HTMLElement
}

const click = async (element: Element | null) => {
  expect(element).not.toBeNull()
  await act(async () => {
    ;(element as HTMLElement).click()
  })
}

const createProps = (
  overrides: Partial<CombatCopilotMatchDialogProps> = {},
): CombatCopilotMatchDialogProps => ({
  isOpen: true,
  settings: { enabled: false, modes: DEFAULT_COPILOT_MATCH_MODES },
  ownedOperatorNames: new Set(['阿米娅']),
  onChange: vi.fn(),
  onClose: vi.fn(),
  ...overrides,
})

describe('CombatCopilotMatchDialog', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    installMatchMedia()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    document.body.style.overflow = ''
    vi.restoreAllMocks()
  })

  const renderDialog = async (overrides: Partial<CombatCopilotMatchDialogProps> = {}) => {
    const props = createProps(overrides)
    await act(async () => {
      root.render(<CombatCopilotMatchDialog {...props} />)
    })
    await act(async () => {
      await Promise.resolve()
    })
    return props
  }

  it('explains the estimate boundary without promising skill or module checks', async () => {
    await renderDialog()

    const text = document.body.textContent ?? ''
    expect(text).toContain('最近一次持有干员识别结果')
    expect(text).toContain('按精英化阶段与等级估算')
    expect(text).toContain('技能等级与模组尚未识别')
    expect(text).toContain('待确认')
    expect(text).not.toContain('潜能')
  })

  it('enables matching and reports mode changes', async () => {
    const props = await renderDialog()

    const toggle = document.querySelector('[role="switch"]')
    expect(toggle?.getAttribute('aria-disabled')).toBeNull()
    expect(toggle?.getAttribute('aria-label')).toBe('按持有干员匹配')
    await click(toggle)

    expect(props.onChange).toHaveBeenCalledWith({
      enabled: true,
      modes: DEFAULT_COPILOT_MATCH_MODES,
    })

    await click(checkboxByLabel('可直接打'))
    expect(props.onChange).toHaveBeenLastCalledWith({
      enabled: false,
      modes: DEFAULT_COPILOT_MATCH_MODES.filter(mode => mode !== 'ready'),
    })

    await click(checkboxByLabel('不可打'))
    expect(props.onChange).toHaveBeenLastCalledWith({
      enabled: false,
      modes: [...DEFAULT_COPILOT_MATCH_MODES, 'blocked'],
    })
  })

  it('disables the switch and asks for owned operator recognition first', async () => {
    const props = await renderDialog({ ownedOperatorNames: new Set<string>() })

    const toggle = document.querySelector('[role="switch"]')
    expect(toggle?.getAttribute('aria-disabled')).toBe('true')
    expect(document.body.textContent).toContain('先识别持有干员')

    await click(toggle)
    expect(props.onChange).not.toHaveBeenCalled()
  })

  it('shows the recognition loading state and keeps the persisted switch unchecked', async () => {
    const props = await renderDialog({
      settings: { enabled: true, modes: DEFAULT_COPILOT_MATCH_MODES },
      operatorsLoading: true,
      operatorsError: '读取失败',
    })

    expect(document.body.textContent).toContain('正在识别持有干员…')
    expect(document.body.textContent).not.toContain('持有干员读取失败')

    const toggle = document.querySelector('[role="switch"]')
    expect(toggle?.getAttribute('aria-disabled')).toBe('true')
    expect(toggle?.getAttribute('aria-checked')).toBe('false')

    await click(toggle)
    expect(props.onChange).not.toHaveBeenCalled()
  })

  it('shows the recognition failure with a retry action and disables matching', async () => {
    const onRetryData = vi.fn()
    const props = await renderDialog({
      settings: { enabled: true, modes: DEFAULT_COPILOT_MATCH_MODES },
      operatorsError: '网络错误',
      onRetryData,
    })

    expect(document.body.textContent).toContain('持有干员读取失败')
    expect(document.body.textContent).not.toContain('正在识别持有干员')
    expect(document.body.textContent).not.toContain('先识别持有干员')

    const toggle = document.querySelector('[role="switch"]')
    expect(toggle?.getAttribute('aria-disabled')).toBe('true')
    expect(toggle?.getAttribute('aria-checked')).toBe('false')

    await click(toggle)
    expect(props.onChange).not.toHaveBeenCalled()

    await click(findButton('重试'))
    expect(onRetryData).toHaveBeenCalledTimes(1)
  })

  it('closes from the footer', async () => {
    const props = await renderDialog()

    await click(findButton('关闭'))
    expect(props.onClose).toHaveBeenCalled()
  })
})
