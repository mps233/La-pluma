// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CombatCopilotSearchBar, { type CombatCopilotSearchBarProps } from './CombatCopilotSearchBar'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const click = async (element: HTMLElement) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

const viewGroup = () => container.querySelector<HTMLElement>('[role="group"][aria-label="结果视图"]')

const viewButton = (label: string) => Array.from(viewGroup()?.querySelectorAll<HTMLButtonElement>('button') ?? [])
  .find(button => button.getAttribute('aria-label') === label)

const createProps = (
  overrides: Partial<CombatCopilotSearchBarProps> = {},
): CombatCopilotSearchBarProps => ({
  keyword: '',
  level: '',
  order: 'hot',
  operatorSelection: { included: [], excluded: [] },
  stages: [],
  stagesLoading: false,
  stagesError: null,
  matchEnabled: false,
  operatorFilterEnabled: false,
  view: 'grid',
  searching: false,
  onKeywordChange: () => {},
  onSubmit: () => {},
  onLevelChange: () => {},
  onOrderChange: () => {},
  onOpenOperatorFilter: () => {},
  onToggleOperatorFilter: () => {},
  onOpenMatch: () => {},
  onViewChange: () => {},
  onRetryData: () => {},
  ...overrides,
})

const renderBar = async (props: CombatCopilotSearchBarProps) => {
  await act(async () => root.render(<CombatCopilotSearchBar {...props} />))
}

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

describe('CombatCopilotSearchBar', () => {
  it('renders the view switch as a single-select toggle group', async () => {
    await renderBar(createProps())

    expect(viewGroup()).not.toBeNull()
    expect(viewButton('网格视图')?.getAttribute('aria-pressed')).toBe('true')
    expect(viewButton('列表视图')?.getAttribute('aria-pressed')).toBe('false')
  })

  it('switches to the list view without selecting the pressed option again', async () => {
    const onViewChange = vi.fn()
    await renderBar(createProps({ onViewChange }))

    await click(viewButton('列表视图')!)
    expect(onViewChange).toHaveBeenCalledWith('list')

    onViewChange.mockClear()
    await click(viewButton('网格视图')!)
    expect(onViewChange).not.toHaveBeenCalled()
  })

  it('reflects the controlled list view', async () => {
    await renderBar(createProps({ view: 'list' }))

    expect(viewButton('网格视图')?.getAttribute('aria-pressed')).toBe('false')
    expect(viewButton('列表视图')?.getAttribute('aria-pressed')).toBe('true')
  })
})
