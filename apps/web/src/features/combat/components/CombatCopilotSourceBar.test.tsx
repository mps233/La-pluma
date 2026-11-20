// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_COPILOT_MATCH_MODES } from '../model/copilotDiscovery'
import type { OperatorSelection } from '../model/operatorFilter'
import type { CopilotPreviewMode } from '../model/copilotPreview'
import { createPanelStateStore, type PanelStateStore } from '../model/panelState'
import type { CopilotSearchOrder } from '../types'
import type {
  CombatCopilotDiscoveryView,
  CombatCopilotFileImportProjection,
  CombatCopilotMatchSettings,
  CombatCopilotSearchProjection,
} from './combatPanelTypes'
import CombatCopilotSourceBar from './CombatCopilotSourceBar'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const click = async (element: HTMLElement) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

const flushTimers = async () => {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

const findButton = (name: string): HTMLButtonElement | undefined => (
  Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .find(button => button.textContent?.trim() === name)
)

const helpPanel = (): HTMLElement | null => (
  document.querySelector<HTMLElement>('[role="dialog"][aria-label="作业输入说明"]')
)

const setSelectValue = async (select: HTMLSelectElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

const selectFile = async (input: HTMLInputElement, selected: File) => {
  Object.defineProperty(input, 'files', { configurable: true, value: [selected] })
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

const pasteClipboard = async (
  input: HTMLInputElement,
  clipboardData: {
    files: File[]
    items: Array<{ kind: string; getAsFile: () => File | null }>
  },
) => {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { configurable: true, value: clipboardData })
  await act(async () => {
    input.dispatchEvent(event)
  })
  return event
}

const search = (overrides: Partial<CombatCopilotSearchProjection> = {}): CombatCopilotSearchProjection => ({
  isOpen: false,
  onOpen: () => {},
  onClose: () => {},
  keywordStore: createPanelStateStore(''),
  levelStore: createPanelStateStore(''),
  operatorStore: createPanelStateStore<OperatorSelection>({ included: [], excluded: [] }),
  operatorFilterEnabledStore: createPanelStateStore<boolean>(true),
  operatorFilterRememberStore: createPanelStateStore<boolean>(true),
  orderStore: createPanelStateStore<CopilotSearchOrder>('hot'),
  matchStore: createPanelStateStore<CombatCopilotMatchSettings>({
    enabled: false,
    modes: [...DEFAULT_COPILOT_MATCH_MODES],
  }),
  viewStore: createPanelStateStore<CombatCopilotDiscoveryView>('grid'),
  stages: [],
  stagesLoading: false,
  stagesError: null,
  operators: [],
  operatorsLoading: false,
  operatorsError: null,
  ownedOperatorNames: new Set(),
  result: null,
  searching: false,
  refreshing: false,
  error: null,
  addingUri: null,
  onSearch: () => {},
  onRetrySearch: () => {},
  onLoadMore: async () => null,
  onCancel: () => {},
  onPreviewUri: () => {},
  onAddToQueue: () => {},
  onRetryData: () => {},
  ...overrides,
})

interface SourceBarProps {
  input: string
  isLoading: boolean
  isAddingToQueue?: boolean
  previewModeStore: PanelStateStore<CopilotPreviewMode>
  search: CombatCopilotSearchProjection
  fileImport?: CombatCopilotFileImportProjection
  onInputChange: (value: string) => void
  onPreview: () => void
  onAddToQueue?: () => void
  onCancelPreview: () => void
}

function baseProps(overrides: Partial<SourceBarProps> = {}): SourceBarProps {
  return {
    input: '',
    isLoading: false,
    previewModeStore: createPanelStateStore<CopilotPreviewMode>('auto'),
    search: search(),
    onInputChange: () => {},
    onPreview: () => {},
    onCancelPreview: () => {},
    ...overrides,
  }
}

describe('CombatCopilotSourceBar', () => {
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
    vi.restoreAllMocks()
  })

  const renderBar = async (props: Partial<SourceBarProps> = {}) => {
    await act(async () => {
      root.render(<CombatCopilotSourceBar {...baseProps(props)} />)
    })
  }

  it('keeps the URI source input and adds the discovery action', async () => {
    await renderBar({ input: 'prts://1234' })

    const uri = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')
    expect(uri?.value).toBe('prts://1234')
    expect(container.querySelector('label[for="combat-copilot-uri"]')).not.toBeNull()
    expect(container.querySelector('input[name="maa-copilot-stage-search"]')).toBeNull()

    const discovery = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim() === '发现')
    expect(discovery).not.toBeUndefined()
    expect(discovery?.getAttribute('aria-haspopup')).toBe('dialog')
    expect(discovery?.getAttribute('aria-controls')).toBe('combat-copilot-discovery-dialog')
  })

  it('opens the discovery dialog from the toolbar', async () => {
    const onOpen = vi.fn()
    await renderBar({ search: search({ onOpen }) })

    await click(Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim() === '发现')!)

    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('previews the typed URI', async () => {
    const onPreview = vi.fn()
    await renderBar({ input: 'prts://1234', onPreview })

    await click(Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.trim() === '预览')!)

    expect(onPreview).toHaveBeenCalledOnce()
  })

  it('clears the typed URI from the icon inside the field and returns focus to the input', async () => {
    const onInputChange = vi.fn()
    await renderBar({ input: 'prts://1234', onInputChange })

    const uri = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!
    const clear = container.querySelector<HTMLButtonElement>('button[aria-label="清除作业链接"]')
    expect(clear).not.toBeNull()
    expect(clear?.title).toBe('清除作业链接')
    expect(clear?.textContent?.trim()).toBe('')
    expect(uri.parentElement?.contains(clear!)).toBe(true)

    await click(clear!)

    expect(onInputChange).toHaveBeenCalledWith('')
    expect(document.activeElement).toBe(uri)
  })

  it('hides the clear action for an empty URI and disables it while a request is in flight', async () => {
    await renderBar({ input: '' })
    expect(container.querySelector('button[aria-label="清除作业链接"]')).toBeNull()

    await renderBar({ input: 'prts://1234', isLoading: true })
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="清除作业链接"]')?.disabled)
      .toBe(true)

    await renderBar({ input: 'prts://1234', isAddingToQueue: true })
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="清除作业链接"]')?.disabled)
      .toBe(true)
  })

  it('reports the active recognition mode inside the URI field and cancels the preview when it changes', async () => {
    const onCancelPreview = vi.fn()
    const previewModeStore = createPanelStateStore<CopilotPreviewMode>('auto')
    await renderBar({ previewModeStore, onCancelPreview })

    const uri = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')
    const mode = container.querySelector<HTMLSelectElement>('select[name="maa-copilot-preview-mode"]')
    expect(uri).not.toBeNull()
    expect(mode).not.toBeNull()
    expect(uri!.parentElement?.contains(mode)).toBe(true)
    expect(mode!.getAttribute('id')).toBe('combat-copilot-preview-mode')
    expect(container.querySelector('label[for="combat-copilot-preview-mode"]')?.textContent)
      .toBe('识别方式')
    expect(Array.from(mode!.options).map(option => option.textContent?.trim()))
      .toEqual(['自动', '单个作业', '作业集'])
    expect(mode!.value).toBe('auto')

    await setSelectValue(mode!, 'set')

    expect(onCancelPreview).toHaveBeenCalledOnce()
    expect(previewModeStore.get()).toBe('set')
    expect(mode!.value).toBe('set')
  })

  it('adds the typed URI to the queue without replacing the preview action', async () => {
    const onPreview = vi.fn()
    const onAddToQueue = vi.fn()
    await renderBar({ input: 'prts://1234', onPreview, onAddToQueue })

    const add = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim() === '加入队列')
    expect(add).not.toBeUndefined()
    expect(add?.disabled).toBe(false)

    await click(add!)

    expect(onAddToQueue).toHaveBeenCalledOnce()
    expect(onPreview).not.toHaveBeenCalled()
    expect(container.textContent).toContain('预览')
  })

  it('disables the queue action for an empty input or while adding', async () => {
    const onAddToQueue = vi.fn()
    await renderBar({ input: '', onAddToQueue })

    const emptyAdd = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim() === '加入队列')
    expect(emptyAdd?.disabled).toBe(true)

    await renderBar({ input: 'prts://1234', isAddingToQueue: true, onAddToQueue })
    const adding = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim() === '加入中')
    expect(adding?.disabled).toBe(true)
    expect(adding?.getAttribute('aria-busy')).toBe('true')
  })

  it('describes the URI, paste and local file sources', async () => {
    await renderBar()

    const uri = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')
    expect(uri?.placeholder).toBe('prts://1234、prts://s1234、作业站链接或粘贴 JSON 文件')
    expect(container.querySelector('label[for="combat-copilot-uri"]')?.textContent)
      .toBe('作业链接，或粘贴 JSON 作业文件')
    expect(container.textContent).not.toContain('支持作业链接，或粘贴/导入本地 JSON 文件。')

    await click(findButton('说明')!)
    expect(helpPanel()?.textContent).toContain('可直接粘贴或导入本地 JSON 文件')
  })

  it('opens the input help as a focusable popover with the source guidance', async () => {
    await renderBar()

    const trigger = findButton('说明')
    expect(trigger).not.toBeUndefined()
    expect(trigger?.tagName).toBe('BUTTON')
    expect(trigger?.getAttribute('aria-expanded')).toBe('false')
    trigger?.focus()
    expect(document.activeElement).toBe(trigger)

    await click(trigger!)

    const panel = helpPanel()
    expect(panel).not.toBeNull()
    expect(trigger?.getAttribute('aria-expanded')).toBe('true')
    expect(panel?.textContent).toContain('在 prts.plus 获取作业链接')
    expect(panel?.textContent).toContain('单作业：prts://1234；作业集：prts://s1234')
    expect(panel?.textContent).toContain('作业站链接会自动识别')
    expect(panel?.textContent).toContain('识别方式可强制按单个作业或作业集读取')
    expect(panel?.textContent).toContain('点击“发现”可按关键词、关卡和干员搜索作业站作业')

    const link = panel?.querySelector<HTMLAnchorElement>('a[href="https://prts.plus/"]')
    expect(link?.textContent).toBe('prts.plus')
    expect(link?.target).toBe('_blank')
    expect(Array.from(panel?.querySelectorAll('code') ?? []).map(code => code.textContent))
      .toEqual(['prts://1234', 'prts://s1234'])
  })

  it('closes the input help with Escape and returns focus to the trigger', async () => {
    await renderBar()
    const trigger = findButton('说明')!

    await click(trigger)
    expect(helpPanel()).not.toBeNull()

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await flushTimers()

    expect(helpPanel()).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })

  it('closes the input help on an outside click', async () => {
    await renderBar()
    const trigger = findButton('说明')!

    await click(trigger)
    expect(helpPanel()).not.toBeNull()

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flushTimers()

    expect(helpPanel()).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('offers a labelled JSON file picker through an icon inside the URI field', async () => {
    await renderBar({ fileImport: { isImporting: false, onImport: () => {} } })

    const uri = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!
    const mode = container.querySelector<HTMLSelectElement>('select[name="maa-copilot-preview-mode"]')!
    const input = container.querySelector<HTMLInputElement>('input[type="file"][name="maa-copilot-file"]')
    expect(input).not.toBeNull()
    expect(input?.accept).toContain('.json')
    expect(container.querySelector('label[for="combat-copilot-file"]')).not.toBeNull()

    const importButton = container.querySelector<HTMLButtonElement>('button[aria-label="导入 JSON 作业文件"]')
    expect(importButton).not.toBeNull()
    expect(importButton?.title).toBe('导入 JSON 作业文件')
    expect(importButton?.textContent?.trim()).toBe('')
    expect(uri.parentElement?.contains(importButton!)).toBe(true)
    expect(importButton?.parentElement).toBe(mode.parentElement)
    expect(container.textContent).not.toContain('导入文件')
  })

  it('imports the chosen file and resets the file input', async () => {
    const onImport = vi.fn()
    await renderBar({ fileImport: { isImporting: false, onImport } })

    const input = container.querySelector<HTMLInputElement>('input[name="maa-copilot-file"]')!
    const chosen = new File(['{}'], 'job.json', { type: 'application/json' })
    const resetValue = vi.fn()
    Object.defineProperty(input, 'value', { configurable: true, get: () => '', set: resetValue })

    await selectFile(input, chosen)

    expect(onImport).toHaveBeenCalledOnce()
    expect(onImport).toHaveBeenCalledWith(chosen)
    expect(resetValue).toHaveBeenCalledWith('')
  })

  it('disables the import icon and swaps it for progress while a file is importing', async () => {
    await renderBar({ fileImport: { isImporting: true, onImport: () => {} } })

    const button = container.querySelector<HTMLButtonElement>('button[aria-label="导入 JSON 作业文件"]')
    expect(button).not.toBeNull()
    expect(button?.disabled).toBe(true)
    expect(button?.getAttribute('aria-busy')).toBe('true')
    expect(button?.querySelector('svg')).not.toBeNull()
    expect(container.textContent).not.toContain('导入文件')
  })

  it('imports a JSON file pasted from the clipboard and prevents the paste', async () => {
    const onImport = vi.fn()
    await renderBar({ fileImport: { isImporting: false, onImport } })

    const uri = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!
    const file = new File(['{}'], 'job.json', { type: 'application/json' })
    const event = await pasteClipboard(uri, { files: [file], items: [] })

    expect(onImport).toHaveBeenCalledOnce()
    expect(onImport).toHaveBeenCalledWith(file)
    expect(event.defaultPrevented).toBe(true)
  })

  it('imports a JSON file exposed through clipboard items', async () => {
    const onImport = vi.fn()
    await renderBar({ fileImport: { isImporting: false, onImport } })

    const uri = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!
    const file = new File(['{}'], 'job.json', { type: 'application/json' })
    const event = await pasteClipboard(uri, {
      files: [],
      items: [{ kind: 'file', getAsFile: () => file }],
    })

    expect(onImport).toHaveBeenCalledOnce()
    expect(onImport).toHaveBeenCalledWith(file)
    expect(event.defaultPrevented).toBe(true)
  })

  it('leaves text pastes untouched', async () => {
    const onImport = vi.fn()
    await renderBar({ fileImport: { isImporting: false, onImport } })

    const uri = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!
    const event = await pasteClipboard(uri, {
      files: [],
      items: [{ kind: 'string', getAsFile: () => null }],
    })

    expect(onImport).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })
})
