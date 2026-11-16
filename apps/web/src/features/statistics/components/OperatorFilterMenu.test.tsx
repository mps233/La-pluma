// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OperatorFilterMenu, { type FilterMenuOption } from './OperatorFilterMenu'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const options: readonly FilterMenuOption[] = [
  { value: 'all', label: '全部' },
  { value: 'owned', label: '已拥有' },
  { value: 'unowned', label: '未拥有' },
]

const labels: Record<string, string> = {
  all: '拥有状态',
  owned: '已拥有',
  unowned: '未拥有',
}

const mediaQueryList = () => (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
})

interface HarnessProps {
  initialValue?: string
  onSelect?: (value: string) => void
}

function Harness({ initialValue = 'all', onSelect }: HarnessProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [value, setValue] = useState(initialValue)

  return (
    <div>
      <OperatorFilterMenu
        menuKey="ownership"
        label={labels[value] ?? '拥有状态'}
        value={value}
        options={options}
        isActive={value !== 'all'}
        open={openMenu === 'ownership'}
        onOpenChange={open => setOpenMenu(open ? 'ownership' : null)}
        onSelect={(next) => {
          setValue(next)
          onSelect?.(next)
        }}
      />
      <OperatorFilterMenu
        menuKey="rarity"
        label="星级"
        value="all"
        options={options}
        isActive={false}
        open={openMenu === 'rarity'}
        onOpenChange={open => setOpenMenu(open ? 'rarity' : null)}
        onSelect={() => {}}
      />
    </div>
  )
}

let container: HTMLDivElement
let root: Root

const flushTimers = async () => {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

const click = async (element: HTMLElement) => {
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await flushTimers()
}

const press = async (target: EventTarget, key: string) => {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
  await flushTimers()
}

const render = async (props: HarnessProps = {}) => {
  await act(async () => root.render(<Harness {...props} />))
}

const trigger = (menuKey = 'ownership') => container.querySelector<HTMLButtonElement>(`button[data-filter-menu="${menuKey}"]`)!
const menu = () => document.body.querySelector<HTMLElement>('[role="menu"]')
const menuItems = () => Array.from(
  document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
)

describe('operator filter dropdown menu', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockImplementation(mediaQueryList())
    vi.stubGlobal('ResizeObserver', class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('renders a menu through a portal with radio selection semantics', async () => {
    await render({ initialValue: 'owned' })
    await click(trigger())

    const surface = menu()!
    expect(surface).not.toBeNull()
    expect(container.contains(surface)).toBe(false)
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(surface.getAttribute('aria-label')).toBe('已拥有筛选')
    expect(menuItems().map(item => item.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
    expect(document.activeElement).toBe(menuItems()[1])
  })

  it('applies the selection, closes and restores trigger focus', async () => {
    const onSelect = vi.fn()
    await render({ onSelect })

    await click(trigger())
    await click(menuItems()[2]!)

    expect(onSelect).toHaveBeenCalledWith('unowned')
    expect(menu()).toBeNull()
    expect(trigger().textContent).toContain('未拥有')
    expect(document.activeElement).toBe(trigger())
  })

  it('closes with Escape and returns focus to the trigger', async () => {
    await render()
    trigger().focus()
    await click(trigger())
    expect(menu()).not.toBeNull()

    await press(document, 'Escape')

    expect(menu()).toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger())
  })

  it('cycles focus with arrows, Home and End', async () => {
    await render({ initialValue: 'owned' })
    await click(trigger())
    expect(document.activeElement).toBe(menuItems()[1])

    await press(menu()!, 'ArrowDown')
    expect(document.activeElement).toBe(menuItems()[2])

    await press(menu()!, 'ArrowDown')
    expect(document.activeElement).toBe(menuItems()[0])

    await press(menu()!, 'ArrowUp')
    expect(document.activeElement).toBe(menuItems()[2])

    await press(menu()!, 'Home')
    expect(document.activeElement).toBe(menuItems()[0])

    await press(menu()!, 'End')
    expect(document.activeElement).toBe(menuItems()[2])

    await press(menu()!, 'ArrowUp')
    expect(document.activeElement).toBe(menuItems()[1])
  })

  it('opens from the trigger with arrow keys and keeps aria wiring', async () => {
    await render()

    await press(trigger(), 'ArrowDown')

    const surface = menu()!
    expect(surface).not.toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(trigger().getAttribute('aria-controls')).toBe(surface.id)
    expect(menuItems().some(item => item === document.activeElement)).toBe(true)
  })

  it('closes on outside pointerdown', async () => {
    await render()
    await click(trigger())

    await act(async () => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    await act(async () => { await Promise.resolve() })

    expect(menu()).toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
  })

  it('closes when focus moves outside the menu', async () => {
    const outside = document.createElement('button')
    outside.textContent = 'outside'
    document.body.appendChild(outside)

    await render()
    await click(trigger())
    expect(menu()).not.toBeNull()

    await act(async () => outside.focus())
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })

    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })

  it('keeps only one menu open at a time', async () => {
    await render()
    await click(trigger('ownership'))
    expect(menu()).not.toBeNull()

    await click(trigger('rarity'))
    expect(document.body.querySelectorAll('[role="menu"]')).toHaveLength(1)
    expect(menu()!.getAttribute('aria-label')).toBe('星级筛选')
    expect(trigger('ownership').getAttribute('aria-expanded')).toBe('false')
    expect(trigger('rarity').getAttribute('aria-expanded')).toBe('true')
  })
})
