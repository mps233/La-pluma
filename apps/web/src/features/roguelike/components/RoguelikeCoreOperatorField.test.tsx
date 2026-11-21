// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/shared/query'
import RoguelikeCoreOperatorField from './RoguelikeCoreOperatorField'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  getOperBoxData: vi.fn(),
  getAllOperators: vi.fn(),
}))

vi.mock('framer-motion', async () => {
  const React = await import('react')
  type MotionTestProps = Record<string, unknown> & { children?: React.ReactNode }
  const motionComponent = (tag: 'button' | 'div' | 'span') => React.forwardRef<HTMLElement, MotionTestProps>(
    ({ children, initial: _initial, animate: _animate, exit: _exit, transition: _transition, ...props }, ref) =>
      React.createElement(tag, { ...props, ref }, children as React.ReactNode),
  )
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    motion: {
      button: motionComponent('button'),
      div: motionComponent('div'),
      span: motionComponent('span'),
    },
    useReducedMotion: () => true,
  }
})

vi.mock('@/features/game-data/api', () => ({
  getAllOperators: mocks.getAllOperators,
  getDepotData: vi.fn(),
  getOperBoxData: mocks.getOperBoxData,
  getItemIconUrl: (id: string | number) => `/items/${id}.png`,
  getOperatorAvatarUrl: (id: string) => `/avatars/${id}.png`,
}))

const operator = (id: string, name: string, rarity = 6) => ({
  id,
  name,
  rarity,
  profession: 'CASTER',
  level: 80,
  elite: 2,
  potential: 1,
})

const ownedOperator = (id: string, name: string, rarity = 6) => operator(id, name, rarity)

const ownedOperatorAt = (
  id: string,
  name: string,
  rarity: number,
  elite: number,
  level: number,
) => ({ id, name, rarity, elite, level, potential: 1 })

let client: ReturnType<typeof createQueryClient>
let container: HTMLDivElement
let root: Root

const flush = async () => {
  await act(async () => {
    for (let index = 0; index < 4; index += 1) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  })
}

const click = async (element: Element | null | undefined, label: string) => {
  expect(element, `clickable ${label}`).toBeTruthy()
  await act(async () => {
    element!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await flush()
}

const buttonWithText = (text: string): HTMLButtonElement | undefined => Array.from(
  document.querySelectorAll<HTMLButtonElement>('button'),
).find(button => button.textContent?.trim() === text)

const buttonWithLabel = (label: string): HTMLButtonElement | null => document.querySelector(
  `button[aria-label="${label}"]`,
)

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')

const dialogChoiceNames = () => Array.from(
  dialog()?.querySelectorAll<HTMLButtonElement>('button[aria-label^="选择"]') ?? [],
).map(button => (button.getAttribute('aria-label') ?? '').replace(/^选择/, ''))

function Harness({
  initialValue = '',
  error,
  disabled,
}: {
  initialValue?: string
  error?: string
  disabled?: boolean
}) {
  const [value, setValue] = useState(initialValue)
  return (
    <>
      <RoguelikeCoreOperatorField
        id="core-operator"
        label="核心干员"
        value={value}
        error={error}
        disabled={disabled}
        onChange={setValue}
      />
      <output data-testid="core-operator-value">{value}</output>
    </>
  )
}

const renderField = async (
  initialValue = '',
  options: { error?: string; disabled?: boolean } = {},
) => {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Harness initialValue={initialValue} {...options} />
      </QueryClientProvider>,
    )
  })
  await flush()
}

const displayedValue = () => document.querySelector('[data-testid="core-operator-value"]')?.textContent

describe('roguelike core operator field', () => {
  beforeEach(() => {
    mocks.getOperBoxData.mockReset().mockResolvedValue({ success: true, data: { data: [] } })
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

  it('shows a short empty placeholder without the removed explanatory hint', async () => {
    await renderField()

    expect(container.textContent).toContain('未选择')
    expect(container.textContent).not.toContain('留空')
    expect(container.textContent).not.toContain('中文名')
    expect(container.textContent).not.toContain('自动选择')
    expect(document.querySelector('[id$="-hint"]')).toBeNull()
    expect(buttonWithText('选择干员')).toBeDefined()
  })

  it('names the field group and the trigger after the core operator', async () => {
    await renderField()

    const group = container.querySelector<HTMLElement>('[role="group"]')
    expect(group?.getAttribute('aria-labelledby')).toBe('core-operator-label')
    expect(document.getElementById('core-operator-label')?.textContent).toBe('核心干员')
    expect(buttonWithLabel('选择核心干员')).not.toBeNull()
    expect(buttonWithText('选择干员')).toBeDefined()
  })

  it('includes the current operator in the replacement trigger name', async () => {
    await renderField('维什戴尔')

    expect(buttonWithLabel('更换核心干员（当前：维什戴尔）')).not.toBeNull()
  })

  it('marks the trigger with the field error message', async () => {
    await renderField('', { error: '核心干员不在当前账号的可选范围内' })

    const trigger = buttonWithLabel('选择核心干员')!
    expect(trigger.getAttribute('aria-invalid')).toBe('true')
    expect(trigger.getAttribute('aria-errormessage')).toBe('core-operator-error')
    expect(document.getElementById('core-operator-error')?.textContent)
      .toBe('核心干员不在当前账号的可选范围内')
  })

  it('does not open the picker while disabled', async () => {
    await renderField('', { disabled: true })

    const trigger = buttonWithLabel('选择核心干员')!
    expect(trigger.disabled).toBe(true)
    await click(trigger, '选择核心干员')
    expect(dialog()).toBeNull()
  })

  it('disables clearing while locked', async () => {
    await renderField('维什戴尔', { disabled: true })

    expect(buttonWithLabel('清除核心干员')?.disabled).toBe(true)
  })

  it('lists only recognized operators when a snapshot exists', async () => {
    mocks.getOperBoxData.mockResolvedValue({
      success: true,
      data: { data: [ownedOperator('char_002_amiya', '阿米娅'), ownedOperator('char_103_angel', '能天使')] },
    })
    mocks.getAllOperators.mockResolvedValue({
      success: true,
      data: [operator('char_002_amiya', '阿米娅'), operator('char_103_angel', '能天使'), operator('char_4135_wisdel', '维什戴尔')],
    })

    await renderField()
    await click(buttonWithText('选择干员'), '选择干员')

    expect(dialog()).not.toBeNull()
    expect(dialog()?.textContent).toContain('阿米娅')
    expect(dialog()?.textContent).toContain('能天使')
    expect(dialog()?.textContent).not.toContain('维什戴尔')
    expect(dialog()?.textContent).not.toContain('已拥有')
    expect(dialog()?.textContent).not.toContain('已识别')
  })

  it('orders the shared picker by elite then level descending', async () => {
    mocks.getOperBoxData.mockResolvedValue({
      success: true,
      data: {
        data: [
          ownedOperatorAt('char_002_amiya', '阿米娅', 5, 1, 70),
          ownedOperatorAt('char_010_chen', '陈', 6, 2, 90),
          ownedOperatorAt('char_202_demkni', '塞雷娅', 6, 0, 60),
        ],
      },
    })
    mocks.getAllOperators.mockResolvedValue({
      success: true,
      data: [operator('char_002_amiya', '阿米娅', 5), operator('char_010_chen', '陈'), operator('char_202_demkni', '塞雷娅')],
    })

    await renderField()
    await click(buttonWithText('选择干员'), '选择干员')

    expect(dialogChoiceNames()).toEqual(['陈', '阿米娅', '塞雷娅'])
  })

  it('falls back to the full catalog when no operator was recognized', async () => {
    mocks.getAllOperators.mockResolvedValue({
      success: true,
      data: [operator('char_002_amiya', '阿米娅'), operator('char_4135_wisdel', '维什戴尔')],
    })

    await renderField()
    await click(buttonWithText('选择干员'), '选择干员')

    expect(dialog()?.textContent).toContain('阿米娅')
    expect(dialog()?.textContent).toContain('维什戴尔')
  })

  it('writes the selected operator name and shows its avatar and name', async () => {
    mocks.getOperBoxData.mockResolvedValue({
      success: true,
      data: { data: [ownedOperator('char_002_amiya', '阿米娅')] },
    })
    mocks.getAllOperators.mockResolvedValue({
      success: true,
      data: [operator('char_002_amiya', '阿米娅')],
    })

    await renderField()
    await click(buttonWithText('选择干员'), '选择干员')
    await click(buttonWithLabel('选择阿米娅'), '选择阿米娅')
    await click(buttonWithText('确认选择'), '确认选择')

    expect(displayedValue()).toBe('阿米娅')
    expect(container.textContent).toContain('阿米娅')
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/avatars/char_002_amiya.png')
    expect(buttonWithText('更换')).toBeDefined()
    expect(buttonWithLabel('清除核心干员')).not.toBeNull()
  })

  it('clears the selection back to the automatic placeholder', async () => {
    mocks.getAllOperators.mockResolvedValue({
      success: true,
      data: [operator('char_4135_wisdel', '维什戴尔')],
    })

    await renderField('维什戴尔')

    expect(displayedValue()).toBe('维什戴尔')
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/avatars/char_4135_wisdel.png')

    await click(buttonWithLabel('清除核心干员'), '清除核心干员')

    expect(displayedValue()).toBe('')
    expect(container.textContent).toContain('未选择')
    expect(container.querySelector('img')).toBeNull()
  })

  it('keeps an unmatched legacy name and still allows reselecting', async () => {
    mocks.getAllOperators.mockResolvedValue({
      success: true,
      data: [operator('char_002_amiya', '阿米娅')],
    })

    await renderField('未收录干员')

    expect(container.textContent).toContain('未收录干员')
    expect(container.querySelector('img')).toBeNull()
    expect(buttonWithText('更换')).toBeDefined()

    await click(buttonWithText('更换'), '更换')
    expect(dialog()).not.toBeNull()
    expect(dialog()?.textContent).toContain('阿米娅')
  })
})
