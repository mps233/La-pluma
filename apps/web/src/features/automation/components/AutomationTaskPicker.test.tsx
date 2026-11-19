// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutomationAvailableTask, TaskFlowItem } from '../types'
import AutomationTaskPicker from './AutomationTaskPicker'
import { AVAILABLE_TASKS } from './automationTaskCatalog'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const flowTask = (id: string): TaskFlowItem => ({
  id,
  commandId: 'fight',
  name: '理智作战',
  icon: null,
  description: '自动刷关卡消耗理智',
  defaultParams: {},
  paramFields: [],
  params: {},
  enabled: true,
})

const onAddTask = vi.fn<(task: AutomationAvailableTask) => void>()

let container: HTMLDivElement
let root: Root

function Host({ disabled = false, flow = [] as TaskFlowItem[] }: {
  disabled?: boolean
  flow?: TaskFlowItem[]
}) {
  return (
    <div>
      <AutomationTaskPicker
        flow={flow}
        disabled={disabled}
        onAddTask={onAddTask}
      />
    </div>
  )
}

const trigger = () => container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!
const menu = () => document.body.querySelector<HTMLElement>('[role="menu"]')
const menuItems = () => (
  Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'))
)

const flushTimers = async () => {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

const openPicker = async () => {
  await act(async () => trigger().click())
  await flushTimers()
}

const clickItem = async (item: HTMLElement) => {
  await act(async () => item.click())
  await flushTimers()
}

const dispatchPointerDown = async (target: EventTarget) => {
  await act(async () => {
    target.dispatchEvent(new Event('pointerdown', { bubbles: true }))
  })
  await flushTimers()
}

const pressEscape = async () => {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  await flushTimers()
}

describe('AutomationTaskPicker', () => {
  beforeEach(() => {
    onAddTask.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('exposes the add-task options as a labelled menu', async () => {
    await act(async () => root.render(<Host />))
    await openPicker()

    expect(trigger().getAttribute('aria-label')).toBe('添加任务')
    expect(trigger().getAttribute('title')).toBe('添加任务')
    expect(trigger().textContent).toBe('')
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    const surface = menu()!
    expect(surface).not.toBeNull()
    expect(container.contains(surface)).toBe(false)
    expect(trigger().getAttribute('aria-controls')).toBe(surface.id)
    expect(surface.getAttribute('aria-label')).toBe('可添加任务')
    expect(menuItems()).toHaveLength(AVAILABLE_TASKS.length)
    expect(menuItems().map(item => item.textContent)).toEqual(
      expect.arrayContaining(AVAILABLE_TASKS.map(task => expect.stringContaining(task.name))),
    )
  })

  it('adds a task through the page callback and closes the menu', async () => {
    await act(async () => root.render(<Host />))
    await openPicker()

    const fightOption = menuItems().find(item => item.textContent?.includes('理智作战'))!
    await clickItem(fightOption)

    expect(onAddTask).toHaveBeenCalledOnce()
    expect(onAddTask.mock.calls[0]?.[0]).toMatchObject({ id: 'fight', name: '理智作战' })
    expect(menu()).toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
  })

  it('counts existing flow rows in the menu', async () => {
    await act(async () => root.render(<Host flow={[flowTask('fight-1'), flowTask('fight-2')]} />))
    await openPicker()

    const fightOption = menuItems().find(item => item.textContent?.includes('理智作战'))!
    expect(fightOption.textContent).toContain('2')
  })

  it('closes when pressing outside the menu', async () => {
    await act(async () => root.render(<Host />))
    await openPicker()

    await dispatchPointerDown(document.body)
    expect(menu()).toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
  })

  it('closes with Escape and restores trigger focus', async () => {
    await act(async () => root.render(<Host />))
    await openPicker()

    const firstMenuItem = menuItems()[0]!
    firstMenuItem.focus()
    expect(document.activeElement).toBe(firstMenuItem)

    await pressEscape()

    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('closes and disables the picker when the flow can no longer be edited', async () => {
    await act(async () => root.render(<Host />))
    await openPicker()
    expect(menu()).not.toBeNull()

    await act(async () => root.render(<Host disabled />))
    await flushTimers()

    expect(menu()).toBeNull()
    expect(trigger().disabled).toBe(true)
    expect(trigger().getAttribute('aria-expanded')).toBe('false')

    await act(async () => root.render(<Host />))
    await flushTimers()

    expect(menu()).toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
  })
})
