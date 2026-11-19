// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AutomationTaskField from './AutomationTaskField'
import type { TaskFlowItem, TaskParamField, TaskParamKey, TaskParamValue } from '../types'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const setInputValue = async (input: HTMLInputElement, value: string) => {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const makeTask = (overrides: Pick<TaskFlowItem, 'id' | 'commandId'> & Partial<TaskFlowItem>): TaskFlowItem => ({
  name: '任务',
  icon: null,
  description: '',
  defaultParams: {},
  paramFields: [],
  params: {},
  enabled: true,
  ...overrides,
})

const renderField = async ({
  task,
  field,
  taskIndex,
  isEditingLocked,
  onUpdateParam,
}: {
  task: TaskFlowItem
  field: TaskParamField
  taskIndex: number
  isEditingLocked: boolean
  onUpdateParam: (taskIndex: number, key: TaskParamKey, value: TaskParamValue) => void
}) => {
  await act(async () => {
    root.render(
      <AutomationTaskField
        task={task}
        field={field}
        taskIndex={taskIndex}
        isEditingLocked={isEditingLocked}
        onUpdateParam={onUpdateParam}
        onSuccess={() => {}}
        onError={() => {}}
      />,
    )
  })
}

const themeField: TaskParamField = { key: 'themes', label: '候选主题', type: 'theme-list' }

const themeTask = (enabled = true) => makeTask({
  id: 'switchtheme-1',
  commandId: 'switchtheme',
  enabled,
  params: { themes: ['深色'] },
})

const findButton = (label: string) => Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
  .find(button => button.textContent?.includes(label))

describe('AutomationTaskField theme-list wrapper', () => {
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

  it('forwards theme edits and additions with the task index', async () => {
    const onUpdateParam = vi.fn()
    await renderField({
      task: themeTask(),
      field: themeField,
      taskIndex: 4,
      isEditingLocked: false,
      onUpdateParam,
    })

    const input = container.querySelector<HTMLInputElement>('input[aria-label="主题 1"]')
    if (!input) throw new Error('missing theme input')
    expect(input.value).toBe('深色')

    await setInputValue(input, '浅色')
    expect(onUpdateParam).toHaveBeenLastCalledWith(4, 'themes', ['浅色'])

    const addButton = findButton('添加主题')
    if (!addButton) throw new Error('missing add theme button')
    await act(async () => addButton.click())
    expect(onUpdateParam).toHaveBeenLastCalledWith(4, 'themes', ['深色', ''])
  })

  it('disables theme controls from the edit lock or a disabled task', async () => {
    const onUpdateParam = vi.fn()
    await renderField({
      task: themeTask(),
      field: themeField,
      taskIndex: 0,
      isEditingLocked: true,
      onUpdateParam,
    })

    expect(container.querySelector<HTMLInputElement>('input[aria-label="主题 1"]')?.disabled).toBe(true)
    expect(findButton('添加主题')?.disabled).toBe(true)

    await renderField({
      task: themeTask(false),
      field: themeField,
      taskIndex: 0,
      isEditingLocked: false,
      onUpdateParam,
    })

    expect(container.querySelector<HTMLInputElement>('input[aria-label="主题 1"]')?.disabled).toBe(true)
    expect(findButton('添加主题')?.disabled).toBe(true)
  })
})

describe('AutomationTaskField infrast-schedule wrapper', () => {
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

  it('uses the task field id and forwards filename and plan index edits', async () => {
    const onUpdateParam = vi.fn()
    await renderField({
      task: makeTask({
        id: 'infrast-1',
        commandId: 'infrast',
        params: { filename: 'base.json', plan_index: 1 },
      }),
      field: { key: 'filename', label: '自定义排班', type: 'infrast-schedule' },
      taskIndex: 5,
      isEditingLocked: false,
      onUpdateParam,
    })

    const filenameInput = container.querySelector<HTMLInputElement>('#automation-infrast-1-filename-filename')
    const planInput = container.querySelector<HTMLInputElement>('#automation-infrast-1-filename-plan-index')
    if (!filenameInput) throw new Error('missing filename input')
    if (!planInput) throw new Error('missing plan index input')
    expect(filenameInput.value).toBe('base.json')
    expect(planInput.value).toBe('1')

    await setInputValue(filenameInput, 'schedules/next.json')
    expect(onUpdateParam).toHaveBeenLastCalledWith(5, 'filename', 'schedules/next.json')

    await setInputValue(planInput, '3')
    expect(onUpdateParam).toHaveBeenLastCalledWith(5, 'plan_index', 3)
  })

  it('disables infrast schedule controls from the edit lock or a disabled task', async () => {
    const onUpdateParam = vi.fn()
    await renderField({
      task: makeTask({ id: 'infrast-1', commandId: 'infrast', params: { filename: 'base.json', plan_index: 0 } }),
      field: { key: 'filename', label: '自定义排班', type: 'infrast-schedule' },
      taskIndex: 0,
      isEditingLocked: true,
      onUpdateParam,
    })

    expect(container.querySelector<HTMLInputElement>('#automation-infrast-1-filename-filename')?.disabled).toBe(true)
    expect(container.querySelector<HTMLInputElement>('#automation-infrast-1-filename-plan-index')?.disabled).toBe(true)
    expect(findButton('编辑排班')?.disabled).toBe(true)

    await renderField({
      task: makeTask({
        id: 'infrast-1',
        commandId: 'infrast',
        enabled: false,
        params: { filename: 'base.json', plan_index: 0 },
      }),
      field: { key: 'filename', label: '自定义排班', type: 'infrast-schedule' },
      taskIndex: 0,
      isEditingLocked: false,
      onUpdateParam,
    })

    expect(container.querySelector<HTMLInputElement>('#automation-infrast-1-filename-filename')?.disabled).toBe(true)
    expect(container.querySelector<HTMLInputElement>('#automation-infrast-1-filename-plan-index')?.disabled).toBe(true)
    expect(findButton('编辑排班')?.disabled).toBe(true)
  })
})
