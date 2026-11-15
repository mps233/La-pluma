// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StageConfig, TaskFlowItem, TaskParamField } from '../types'
import AutomationStageEditor from './AutomationStageEditor'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  loadUserConfig: vi.fn(),
  generateTrainingPlan: vi.fn(),
}))

vi.mock('@/features/user-config', () => ({ loadUserConfig: mocks.loadUserConfig }))
vi.mock('@/features/training', () => ({ generateTrainingPlan: mocks.generateTrainingPlan }))

const field: TaskParamField = {
  key: 'stages',
  label: '关卡',
  type: 'multi-stages',
  placeholder: '1-7 或 HD-7',
}

const stage = (name: string, times = '1', extra: Partial<StageConfig> = {}): StageConfig => ({
  stage: name,
  times,
  ...extra,
})

const makeTask = (stages: Array<string | StageConfig>): TaskFlowItem => ({
  id: 'fight-1',
  commandId: 'fight',
  name: '理智作战',
  icon: null,
  description: '自动刷关卡消耗理智',
  defaultParams: {},
  paramFields: [field],
  params: { stages },
  enabled: true,
})

const onUpdate = vi.fn<(taskIndex: number, key: string, value: Array<string | StageConfig>) => void>()
const onSuccess = vi.fn<(message: string) => void>()
const onError = vi.fn<(message: string) => void>()

let container: HTMLDivElement
let root: Root

const flush = async () => {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve()
  })
}

function Host({
  initialStages,
  isRunning = false,
  hint,
}: {
  initialStages: Array<string | StageConfig>
  isRunning?: boolean
  hint?: string
}) {
  const [task, setTask] = useState(() => makeTask(initialStages))

  return (
    <AutomationStageEditor
      field={field}
      fieldId="automation-fight-1-stages"
      task={task}
      taskIndex={0}
      isRunning={isRunning}
      hint={hint}
      onUpdate={(taskIndex, key, value) => {
        onUpdate(taskIndex, key, value)
        setTask(current => ({ ...current, params: { ...current.params, [key]: value } }))
      }}
      onSuccess={onSuccess}
      onError={onError}
    />
  )
}

const renderEditor = async (initialStages: Array<string | StageConfig>, isRunning = false, hint?: string) => {
  await act(async () => root.render(<Host initialStages={initialStages} isRunning={isRunning} hint={hint} />))
  await flush()
}

const click = async (label: string) => {
  const button = container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)
  expect(button).not.toBeNull()
  await act(async () => button?.click())
  await flush()
}

describe('AutomationStageEditor', () => {
  beforeEach(() => {
    mocks.loadUserConfig.mockReset().mockResolvedValue({ success: true, data: { queue: [] } })
    mocks.generateTrainingPlan.mockReset().mockResolvedValue({ success: false })
    onUpdate.mockReset()
    onSuccess.mockReset()
    onError.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('adds smart stages generated from the training plan and reports success', async () => {
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: { queue: [{ name: '阿米娅' }] } })
    mocks.generateTrainingPlan.mockResolvedValue({
      success: true,
      data: {
        operators: [{ name: '阿米娅' }],
        stages: [{ stage: 'AP-5', totalTimes: 3 }],
      },
    })

    await renderEditor([stage('CE-6', '2'), stage('1-7', '1', { pinned: true }), 'LS-6'])
    await click('加入智能养成关卡')

    expect(mocks.generateTrainingPlan).toHaveBeenCalledWith({ mode: 'current' })
    expect(onUpdate).toHaveBeenCalledWith(0, 'stages', expect.any(Array))
    expect(onSuccess).toHaveBeenCalledWith('已添加智能养成计划：1 个关卡')
    expect(container.textContent).toContain('正在养成：阿米娅')
  })

  it('reports an empty training queue and clears the loading state without editing stages', async () => {
    await renderEditor(['1-7'])
    await click('加入智能养成关卡')

    expect(onUpdate).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('智能养成队列为空，请先添加干员')
    expect(mocks.generateTrainingPlan).not.toHaveBeenCalled()
    expect(container.querySelector('[aria-label="加入智能养成关卡"]')?.hasAttribute('aria-busy')).toBe(false)
  })

  it('reports plan failures and thrown errors instead of writing stages', async () => {
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: { queue: [{ name: '阿米娅' }] } })
    mocks.generateTrainingPlan.mockResolvedValueOnce({ success: false, message: '计划服务不可用' })

    await renderEditor(['1-7'])
    await click('加入智能养成关卡')

    expect(onUpdate).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('生成刷取计划失败')

    mocks.generateTrainingPlan.mockRejectedValueOnce(new Error('网络中断'))
    await click('加入智能养成关卡')

    expect(onUpdate).not.toHaveBeenCalled()
    expect(onError).toHaveBeenLastCalledWith('操作失败: 网络中断')
  })

  it('reports a complete plan without inserting empty smart stages', async () => {
    mocks.loadUserConfig.mockResolvedValue({ success: true, data: { queue: [{ name: '阿米娅' }] } })
    mocks.generateTrainingPlan.mockResolvedValue({ success: true, data: { operators: [{ name: '阿米娅' }], stages: [] } })

    await renderEditor(['1-7'])
    await click('加入智能养成关卡')

    expect(onUpdate).not.toHaveBeenCalled()
    expect(onSuccess).toHaveBeenCalledWith('当前干员材料已集齐！')
  })

  it('removes smart stages without asking the training domain', async () => {
    await renderEditor([
      stage('AP-5', '1', { pinned: true }),
      stage('CE-6', '2', { smart: true, trainingOperators: ['阿米娅'] }),
      '1-7',
      { stage: '', times: '' },
    ])

    expect(container.textContent).toContain('正在养成：阿米娅')
    await click('移除智能养成关卡')

    expect(onUpdate).toHaveBeenCalledWith(0, 'stages', expect.any(Array))
    expect(container.textContent).not.toContain('正在养成：阿米娅')
    expect(onSuccess).toHaveBeenCalledWith('已移除智能养成关卡')
    expect(mocks.loadUserConfig).not.toHaveBeenCalled()
    expect(mocks.generateTrainingPlan).not.toHaveBeenCalled()
  })

  it('wires stage time stepping and pinning buttons to draft updates', async () => {
    await renderEditor(['1-7', stage('CE-6', '2')])

    await click('增加关卡 1 的执行次数')
    expect(onUpdate).toHaveBeenLastCalledWith(0, 'stages', [{ stage: '1-7', times: '1' }, stage('CE-6', '2')])

    await click('减少关卡 2 的执行次数')
    expect(onUpdate).toHaveBeenLastCalledWith(0, 'stages', [{ stage: '1-7', times: '1' }, stage('CE-6', '1')])

    await click('置顶：关卡 1')
    expect(onUpdate).toHaveBeenLastCalledWith(0, 'stages', [
      { stage: '1-7', times: '1', pinned: true },
      stage('CE-6', '1'),
    ])
  })

  it('renders the stage hint as a focusable tooltip beside the block title badge', async () => {
    const stageHint = '使用 HD-数字代表当前活动关卡；置顶关卡会优先执行。次数为该关卡的累计作战局数上限（连战中的每一局都计 1），留空表示不限制局数'
    await renderEditor(['1-7', stage('CE-6', '2')], false, stageHint)

    const title = container.querySelector('.automation-stage-editor-title')
    const trigger = title?.querySelector<HTMLButtonElement>('button[aria-label="关卡计划说明"]')
    expect(title?.textContent).toContain('关卡计划')
    expect(title?.textContent).toContain('2 个关卡')
    expect(trigger).not.toBeNull()
    expect(trigger?.previousElementSibling?.tagName).toBe('SPAN')
    expect(trigger?.previousElementSibling?.textContent).toBe('2 个关卡')
    expect(trigger?.getAttribute('aria-describedby')).toBeNull()
    expect(container.querySelector('p')).toBeNull()

    await act(async () => trigger?.focus())
    const tooltipId = trigger?.getAttribute('aria-describedby')
    const tooltip = tooltipId ? document.getElementById(tooltipId) : null
    expect(tooltip?.getAttribute('role')).toBe('tooltip')
    expect(tooltip?.textContent).toBe(stageHint)

    await act(async () => trigger?.blur())
    expect(trigger?.getAttribute('aria-describedby')).toBeNull()
  })

  it('disables stage editing controls while running', async () => {
    await renderEditor(['1-7'], true)

    const stageInput = container.querySelector<HTMLInputElement>('#automation-fight-1-stages-0')
    expect(stageInput?.disabled).toBe(true)
    expect(container.querySelector<HTMLButtonElement>('[aria-label="加入智能养成关卡"]')?.disabled).toBe(true)
    expect(container.querySelector<HTMLButtonElement>('[aria-label="删除关卡 1"]')).toBeNull()
    expect(container.querySelector<HTMLButtonElement>('[aria-label="关卡计划说明"]')).toBeNull()
  })
})
