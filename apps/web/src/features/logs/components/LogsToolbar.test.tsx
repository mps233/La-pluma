// @vitest-environment jsdom

import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LogsToolbar from './LogsToolbar'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const optionInTriggerPopup = (trigger: HTMLElement, optionLabel: string) => {
  const popupId = trigger.getAttribute('aria-controls')
  const popup = popupId ? document.getElementById(popupId) : null
  return popup
    ? [...popup.querySelectorAll('[role="option"]')].find(node => node.textContent?.trim() === optionLabel)
    : undefined
}

type ToolbarProps = ComponentProps<typeof LogsToolbar>

const baseProps = (): ToolbarProps => ({
  autoScroll: true,
  onAutoScrollChange: () => {},
  runId: '',
  runIds: ['run-1'],
  onRunIdChange: () => {},
  events: 'key',
  onEventsChange: () => {},
  collapseRepeats: true,
  onCollapseRepeatsChange: () => {},
  filter: 'all',
  onFilterChange: () => {},
  search: '',
  onSearchChange: () => {},
  viewingHistory: false,
  paused: false,
  onTogglePause: () => {},
  canExport: true,
  onClear: () => {},
  onExport: () => {},
})

let container: HTMLDivElement
let root: Root

const renderToolbar = async (overrides: Partial<ToolbarProps> = {}) => {
  await act(async () => root.render(<LogsToolbar {...baseProps()} {...overrides} />))
  await act(async () => {
    await Promise.resolve()
  })
}

const findSwitchByLabel = (label: string) =>
    container.querySelector(`[role="switch"][aria-label="${label}"]`)

const isSelectOpen = () => {
  const listbox = document.querySelector('[role="listbox"]')
  if (!listbox) return false
  return !listbox.parentElement?.hasAttribute('data-closed')
}

const chooseSelectOption = async (label: string, optionLabel: string) => {
  const trigger = container.querySelector(`[aria-label="${label}"]`)
  expect(trigger).not.toBeNull()
  await act(async () => (trigger as HTMLElement).click())
  const option = optionInTriggerPopup(trigger as HTMLElement, optionLabel)
  expect(option, `未找到选项：${optionLabel}`).toBeTruthy()
  await act(async () => (option as HTMLElement).click())
  await act(async () => {})
}

describe('LogsToolbar', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('offers all logs or a specific run independently of the event filter', async () => {
    const onRunIdChange = vi.fn()
    await renderToolbar({ onRunIdChange })
    const scope = container.querySelector('[aria-label="执行范围"]')
    expect(scope?.textContent).toContain('全部执行与未关联日志')
    await act(async () => (scope as HTMLElement).click())
    const popupId = scope!.getAttribute('aria-controls')
    const options = [...(document.getElementById(popupId!)?.querySelectorAll('[role="option"]') ?? [])]
    expect(options.map(node => node.textContent?.trim())).toEqual(['全部执行与未关联日志', 'Run · run-1'])
    const target = options.find(node => node.textContent?.trim() === 'Run · run-1') as HTMLElement
    await act(async () => target.click())
    await act(async () => {})
    expect(isSelectOpen()).toBe(false)
    expect(onRunIdChange).toHaveBeenCalledWith('run-1')
    expect(container.querySelector('[aria-label="事件范围"]')?.textContent).toContain('关键事件')
  })

  it('reports an explicit run selection', async () => {
    const onRunIdChange = vi.fn()
    await renderToolbar({ onRunIdChange })
    await chooseSelectOption('执行范围', 'Run · run-1')
    expect(onRunIdChange).toHaveBeenCalledWith('run-1')
  })

  it('disables run scope and following for files and keeps event selection available', async () => {
    await renderToolbar({ viewingHistory: true })
    expect((container.querySelector('[aria-label="执行范围"]') as HTMLButtonElement)?.disabled).toBe(true)
    expect(container.querySelector('[aria-label="执行范围"]')?.textContent).toContain('历史文件不区分 Run')
    expect((container.querySelector('[aria-label="事件范围"]') as HTMLButtonElement)?.disabled).toBe(false)
    expect(findSwitchByLabel('自动滚动')?.getAttribute('aria-disabled')).toBe('true')
    expect(container.querySelector('[aria-label="自动滚动：历史文件不提供自动滚动"]')).not.toBeNull()
  })

  it('explains why export is unavailable', async () => {
    await renderToolbar({ canExport: false })
    expect(container.querySelector('[aria-label="导出筛选结果：当前筛选没有可导出的日志"]')).not.toBeNull()
  })

  it('clears the search from the input group', async () => {
    const onSearchChange = vi.fn()
    await renderToolbar({ search: 'needle', onSearchChange })
    const clear = container.querySelector<HTMLElement>('[aria-label="清除搜索"]')
    expect(clear).not.toBeNull()
    await act(async () => clear?.click())
    expect(onSearchChange).toHaveBeenCalledWith('')
  })

  it('turns browser autofill off for the log search field', async () => {
    await renderToolbar()
    const search = container.querySelector('input[aria-label="搜索日志内容"]')
    expect(search?.getAttribute('autocomplete')).toBe('off')
  })

  it('distinguishes clearing the screen and exporting selected records', async () => {
    const onClear = vi.fn()
    await renderToolbar({ onClear })
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    await act(async () => buttons.find(button => button.textContent?.trim() === '清屏')?.click())
    expect(onClear).toHaveBeenCalledOnce()
    expect(buttons.some(button => button.textContent === '导出筛选结果')).toBe(true)
  })
})
