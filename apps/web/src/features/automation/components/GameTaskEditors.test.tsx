// @vitest-environment jsdom

import { act, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/shared/query'
import type { OperProgressPlan } from '../types'
import OperProgressPlansEditor from './OperProgressPlansEditor'
import ThemeListEditor from './ThemeListEditor'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const optionInTriggerPopup = (trigger: HTMLElement, optionLabel: string) => {
  const popupId = trigger.getAttribute('aria-controls')
  const popup = popupId ? document.getElementById(popupId) : null
  return popup
    ? [...popup.querySelectorAll('[role="option"]')].find(node => node.textContent?.trim() === optionLabel)
    : undefined
}

const mocks = vi.hoisted(() => ({
  getOperBoxData: vi.fn(),
  getAllOperators: vi.fn(),
}))

vi.mock('framer-motion', async () => {
  const React = await import('react')
  type MotionTestProps = Record<string, unknown> & { children?: ReactNode }
  const motionComponent = (tag: 'button' | 'div' | 'span') => React.forwardRef<HTMLElement, MotionTestProps>(
    ({ children, initial: _initial, animate: _animate, transition: _transition, ...props }, ref) =>
      React.createElement(tag, { ...props, ref }, children as ReactNode),
  )
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: {
      button: motionComponent('button'),
      div: motionComponent('div'),
      span: motionComponent('span'),
    },
    useReducedMotion: () => true,
  }
})

vi.mock('@/features/game-data/api', () => ({
  getOperBoxData: mocks.getOperBoxData,
  getAllOperators: mocks.getAllOperators,
  getDepotData: vi.fn(),
  getItemIconUrl: (id: string | number) => `/items/${id}.png`,
  getOperatorAvatarUrl: (id: string) => `/avatars/${id}.png`,
}))

const ownedOperator = (id: string, name: string, profession: string) => ({
  id,
  name,
  rarity: 6,
  profession,
  level: 70,
  elite: 1,
  potential: 2,
})

const catalogOperator = (id: string, name: string, profession: string) => ({
  id,
  name,
  rarity: 6,
  profession,
  level: 1,
  elite: 0,
  potential: 1,
})

const ownedOperatorAt = (
  id: string,
  name: string,
  rarity: number,
  elite: number,
  level: number,
  profession: string,
) => ({ id, name, rarity, profession, elite, level, potential: 1 })

let root: Root
let container: HTMLDivElement
let client: ReturnType<typeof createQueryClient>
const onPlans = vi.fn<(plans: OperProgressPlan[]) => void>()
const onThemes = vi.fn<(themes: string[]) => void>()

function Host({ disabled = false, initialPlans = [] }: { disabled?: boolean; initialPlans?: OperProgressPlan[] }) {
  const [plans, setPlans] = useState<OperProgressPlan[]>(initialPlans)
  const [themes, setThemes] = useState<string[]>([])
  return <>
    <OperProgressPlansEditor plans={plans} disabled={disabled} onChange={value => { setPlans(value); onPlans(value) }} />
    <ThemeListEditor themes={themes} disabled={disabled} onChange={value => { setThemes(value); onThemes(value) }} />
  </>
}

const render = async (node: ReactNode) => {
  await act(async () => root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>))
}

const flush = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

const findButton = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')]
  .find(node => node.getAttribute('aria-label') === name || node.textContent?.trim() === name)

const click = async (name: string) => {
  const target = findButton(name)
  if (!target) throw new Error(`未找到按钮：${name}`)
  await act(async () => target.click())
  await flush()
}

const setValue = async (name: string, value: string) => {
  const control = document.querySelector<HTMLElement>(`[aria-label="${name}"]`)
  if (!control) throw new Error(`未找到控件：${name}`)

  if (control.getAttribute('role') === 'combobox') {
    await act(async () => control.click())
    const option = optionInTriggerPopup(control, value)
    if (!option) throw new Error(`未找到选项：${value}`)
    await act(async () => (option as HTMLElement).click())
    await flush()
    return
  }

  const input = control as HTMLInputElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')

const dialogButtons = () => [...(dialog()?.querySelectorAll<HTMLButtonElement>('button') ?? [])]

const operatorChoiceCount = () => dialogButtons()
  .filter(node => node.getAttribute('aria-label')?.startsWith('选择') || node.getAttribute('aria-label')?.startsWith('已选择'))
  .length

const operatorChoiceNames = () => dialogButtons()
  .filter(node => node.getAttribute('aria-label')?.startsWith('选择'))
  .map(node => (node.getAttribute('aria-label') ?? '').replace(/^选择/, ''))

const selectOperator = async (name: string) => {
  await click(`选择${name}`)
  await click('确认选择')
}

describe('game task editors', () => {
  beforeEach(async () => {
    onPlans.mockReset()
    onThemes.mockReset()
    mocks.getOperBoxData.mockReset().mockResolvedValue({ success: true, data: null })
    mocks.getAllOperators.mockReset().mockResolvedValue({ success: true, data: [] })
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
    client = createQueryClient()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    client.clear()
    container.remove()
    vi.restoreAllMocks()
  })

  it('keeps legacy plans editable without profession or name inputs', async () => {
    await render(<Host initialPlans={[{ role: 'Caster', name: '阿米娅', elite: 2 }]} />)

    expect(document.querySelector('[aria-label="培养计划 1 职业"]')).toBeNull()
    expect(document.querySelector('[aria-label="培养计划 1 干员姓名"]')).toBeNull()
    expect(container.textContent).toContain('阿米娅')
    expect(container.textContent).toContain('术师')
    expect(findButton('更换干员')).toBeDefined()

    await setValue('培养计划 1 技能等级', '7 级')
    expect(onPlans).toHaveBeenLastCalledWith([{ role: 'Caster', name: '阿米娅', elite: 2, skill_level: 7 }])
  })

  it('reflects legacy plans that only carry a name, a profession or neither', async () => {
    await render(<Host initialPlans={[
      { name: '阿米娅', elite: 2 },
      { role: 'Unknown', name: '', skill_level: 7 },
      { role: 'Tank', name: '塞雷娅' },
    ]} />)

    expect(container.textContent).toContain('阿米娅')
    expect(container.textContent).toContain('未选择干员')
    expect(container.textContent).toContain('重装')
    expect(document.querySelector('[aria-label="培养计划 2 技能等级"]')?.textContent).toContain('7 级')

    await click('清除培养计划 3 的干员')
    expect(onPlans).toHaveBeenLastCalledWith([
      { name: '阿米娅', elite: 2 },
      { role: 'Unknown', name: '', skill_level: 7 },
      { role: 'Unknown', name: '' },
    ])
  })

  it('lists only recognized operators and writes the selected profession and name', async () => {
    mocks.getOperBoxData.mockResolvedValue({
      success: true,
      data: {
        operCount: 2,
        data: [
          ownedOperator('char_002_amiya', '阿米娅', 'CASTER'),
          ownedOperator('char_010_chen', '陈', 'WARRIOR'),
        ],
      },
    })
    mocks.getAllOperators.mockResolvedValue({
      success: true,
      data: [
        catalogOperator('char_002_amiya', '阿米娅', 'CASTER'),
        catalogOperator('char_010_chen', '陈', 'WARRIOR'),
        catalogOperator('char_180_amgoat', '艾雅法拉', 'CASTER'),
      ],
    })

    await render(<Host />)
    await click('添加培养计划')
    expect(container.textContent).toContain('未选择干员')

    await click('选择干员')
    expect(dialog()).not.toBeNull()
    expect(operatorChoiceCount()).toBe(2)
    expect(dialog()?.textContent).toContain('阿米娅')
    expect(dialog()?.textContent).not.toContain('艾雅法拉')

    await setValue('搜索干员名称', '阿米')
    expect(operatorChoiceCount()).toBe(1)

    await selectOperator('阿米娅')
    expect(onPlans).toHaveBeenLastCalledWith([{ role: 'Caster', name: '阿米娅' }])
    expect(dialog()).toBeNull()
    expect(container.textContent).toContain('更换干员')

    await setValue('培养计划 1 精英目标', '精英二')
    expect(onPlans).toHaveBeenLastCalledWith([{ role: 'Caster', name: '阿米娅', elite: 2 }])
  })

  it('orders the shared picker by elite then level ascending', async () => {
    mocks.getOperBoxData.mockResolvedValue({
      success: true,
      data: {
        operCount: 4,
        data: [
          ownedOperatorAt('char_202_demkni', '塞雷娅', 6, 0, 60, 'TANK'),
          ownedOperatorAt('char_002_amiya', '阿米娅', 5, 1, 70, 'CASTER'),
          ownedOperatorAt('char_180_amgoat', '艾雅法拉', 6, 1, 80, 'CASTER'),
          ownedOperatorAt('char_010_chen', '陈', 6, 2, 90, 'WARRIOR'),
        ],
      },
    })
    mocks.getAllOperators.mockResolvedValue({
      success: true,
      data: [
        catalogOperator('char_202_demkni', '塞雷娅', 'TANK'),
        catalogOperator('char_002_amiya', '阿米娅', 'CASTER'),
        catalogOperator('char_180_amgoat', '艾雅法拉', 'CASTER'),
        catalogOperator('char_010_chen', '陈', 'WARRIOR'),
      ],
    })

    await render(<Host />)
    await click('添加培养计划')
    await click('选择干员')

    expect(operatorChoiceNames()).toEqual(['塞雷娅', '阿米娅', '艾雅法拉', '陈'])
  })

  it('shows the selected operator avatar resolved from the catalog', async () => {
    mocks.getOperBoxData.mockResolvedValue({
      success: true,
      data: {
        operCount: 1,
        data: [ownedOperator('char_010_chen', '陈', 'WARRIOR')],
      },
    })
    mocks.getAllOperators.mockResolvedValue({
      success: true,
      data: [catalogOperator('char_010_chen', '陈', 'WARRIOR')],
    })

    await render(<Host />)
    await click('添加培养计划')
    await click('选择干员')
    await selectOperator('陈')
    await flush()

    expect(container.querySelector('img')?.getAttribute('src')).toBe('/avatars/char_010_chen.png')
  })

  it('resolves repeated operator names with the stored profession', async () => {
    mocks.getAllOperators.mockResolvedValue({
      success: true,
      data: [
        catalogOperator('char_002_amiya', '阿米娅', 'CASTER'),
        catalogOperator('char_1001_amiya2', '阿米娅', 'WARRIOR'),
      ],
    })

    await render(<Host initialPlans={[{ role: 'Warrior', name: '阿米娅' }]} />)
    await flush()

    expect(container.querySelector('img')?.getAttribute('src')).toBe('/avatars/char_1001_amiya2.png')
  })

  it('keeps the generic portrait when the catalog cannot resolve the saved name', async () => {
    mocks.getAllOperators.mockResolvedValue({
      success: true,
      data: [catalogOperator('char_010_chen', '陈', 'WARRIOR')],
    })

    await render(<Host initialPlans={[{ role: 'Caster', name: '未收录干员' }]} />)
    await flush()

    expect(container.textContent).toContain('未收录干员')
    expect(container.querySelector('img')).toBeNull()
  })

  it('falls back to the generic portrait when the avatar image fails to load', async () => {
    mocks.getAllOperators.mockResolvedValue({
      success: true,
      data: [catalogOperator('char_002_amiya', '阿米娅', 'CASTER')],
    })

    await render(<Host initialPlans={[{ role: 'Caster', name: '阿米娅' }]} />)
    await flush()

    const image = container.querySelector('img')
    expect(image?.getAttribute('src')).toBe('/avatars/char_002_amiya.png')

    await act(async () => image?.dispatchEvent(new Event('error', { bubbles: true })))

    expect(container.querySelector('img')).toBeNull()
  })

  it('falls back to the whole catalog when no operator was recognized', async () => {
    mocks.getAllOperators.mockResolvedValue({
      success: true,
      data: [
        catalogOperator('char_180_amgoat', '艾雅法拉', 'CASTER'),
        catalogOperator('char_010_chen', '陈', 'WARRIOR'),
      ],
    })

    await render(<Host />)
    await click('添加培养计划')
    await click('选择干员')
    await flush()

    expect(operatorChoiceCount()).toBe(2)
    expect(dialog()?.textContent).toContain('艾雅法拉')
    expect(dialog()?.textContent).toContain('陈')
    expect(dialog()?.textContent).not.toContain('识别')
    expect(dialog()?.textContent).not.toContain('拥有')

    await selectOperator('陈')
    expect(onPlans).toHaveBeenLastCalledWith([{ role: 'Warrior', name: '陈' }])
  })

  it('clears the selected operator while keeping the cultivation targets', async () => {
    await render(<Host initialPlans={[{ role: 'Caster', name: '阿米娅', elite: 2 }]} />)

    await click('清除培养计划 1 的干员')

    expect(onPlans).toHaveBeenLastCalledWith([{ role: 'Unknown', name: '', elite: 2 }])
    expect(container.textContent).toContain('未选择干员')
    expect(findButton('选择干员')).toBeDefined()
    expect(findButton('清除培养计划 1 的干员')).toBeUndefined()
  })

  it('preserves the candidate theme list while editing and removing entries', async () => {
    await render(<Host />)
    await click('添加主题')
    await setValue('主题 1', '明日方舟')
    await click('添加主题')
    await setValue('主题 2', '新主题')
    expect(onThemes).toHaveBeenLastCalledWith(['明日方舟', '新主题'])
    await click('删除主题 1')
    expect(onThemes).toHaveBeenLastCalledWith(['新主题'])
  })

  it('disables editing and adding while execution owns the controls', async () => {
    await render(<Host />)
    await click('添加培养计划')
    await click('添加主题')
    await render(<Host disabled initialPlans={[{ role: 'Caster', name: '阿米娅', elite: 2 }]} />)
    expect([...container.querySelectorAll('input, select, button')].every(node => (node as HTMLInputElement).disabled)).toBe(true)
    expect(container.textContent).toContain('专精会占用训练室')
    expect(container.textContent).toContain('实际结果以执行详情为准')
  })
})
