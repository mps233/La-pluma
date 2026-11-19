// @vitest-environment jsdom

import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/stores'
import ThemeToggle from './ThemeToggle'

afterEach(cleanup)

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  useReducedMotion: () => false,
  motion: {
    button: forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
      whileHover?: unknown
      whileTap?: unknown
    }>(function MockMotionButton({ whileHover: _whileHover, whileTap: _whileTap, ...props }, ref) {
      return <button ref={ref} {...props} />
    }),
    div: forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & {
      initial?: unknown
      animate?: unknown
      exit?: unknown
      transition?: unknown
    }>(function MockMotionDiv({ initial: _initial, animate: _animate, exit: _exit, transition: _transition, ...props }, ref) {
      return <div ref={ref} {...props} />
    }),
  },
}))

const mediaQueryList = (query: string): MediaQueryList => ({
  matches: query === '(prefers-color-scheme: dark)',
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
})

let frameRunning = false

describe('ThemeToggle mobile menu', () => {
  beforeEach(() => {
    frameRunning = false
    window.matchMedia = vi.fn(mediaQueryList)
    window.requestAnimationFrame = vi.fn(callback => {
      // Liquid Glass keeps scheduling its own animation frames. Run each
      // outer frame synchronously for focus assertions, but drop re-entrant
      // frames so the synchronous stub cannot recurse forever.
      if (frameRunning) return 1
      frameRunning = true
      try {
        callback(0)
      } finally {
        frameRunning = false
      }
      return 1
    })
    window.cancelAnimationFrame = vi.fn()
    useUIStore.getState().setTheme('system')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens an anchored radio menu and applies the selected theme', async () => {
    const user = userEvent.setup({ delay: null })
    render(<ThemeToggle />)
    const trigger = screen.getByRole('button', { name: '切换界面主题，当前跟随系统' })

    await user.click(trigger)
    const menu = screen.getByRole('menu', { name: '选择界面主题' })
    const selectedOption = within(menu).getByRole('menuitemradio', { checked: true })
    expect(selectedOption.textContent).toContain('跟随系统')
    expect(document.activeElement).toBe(selectedOption)

    const lightOption = within(menu).getByRole('menuitemradio', { name: '亮色模式' })
    await user.click(lightOption)

    expect(useUIStore.getState().theme).toBe('light')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('keeps the desktop segmented control and store selection in sync', async () => {
    const user = userEvent.setup({ delay: null })
    render(<ThemeToggle />)

    const group = screen.getByRole('group', { name: '界面主题' })
    const buttons = within(group).getAllByRole('button')

    expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual([
      '亮色模式',
      '暗色模式',
      '跟随系统',
    ])
    expect(buttons.every(button => (button as HTMLButtonElement).type === 'button')).toBe(true)
    expect(group.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(3)
    expect(buttons.filter(button => button.getAttribute('aria-pressed') === 'true')).toEqual([buttons[2]])
    expect(group.dataset.theme).toBe('system')

    await user.click(buttons[0]!)

    expect(useUIStore.getState().theme).toBe('light')
    expect(group.dataset.theme).toBe('light')
    expect(buttons.filter(button => button.getAttribute('aria-pressed') === 'true')).toEqual([buttons[0]])
  })

  it('closes with Escape and restores focus to the trigger', async () => {
    const user = userEvent.setup({ delay: null })
    render(<ThemeToggle />)
    const trigger = screen.getByRole('button', { name: '切换界面主题，当前跟随系统' })
    await user.click(trigger)

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('moves through options with arrow keys and closes when tabbing away', async () => {
    const user = userEvent.setup({ delay: null })
    render(
      <div className="la-pluma-navbar-actions">
        <ThemeToggle />
        <a href="https://github.com/mps233/La-pluma" className="la-pluma-github-link">GitHub</a>
      </div>,
    )
    const trigger = screen.getByRole('button', { name: '切换界面主题，当前跟随系统' })
    const githubLink = screen.getByRole('link', { name: 'GitHub' })
    await user.click(trigger)

    const options = screen.getAllByRole('menuitemradio')
    expect(document.activeElement).toBe(options[2])

    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(options[0])

    await user.keyboard('{End}')
    expect(document.activeElement).toBe(options[2])

    // Tab is handled by the menu itself (focus trap + close), so dispatch the
    // keydown directly instead of letting userEvent perform its own traversal.
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(githubLink)

    await user.click(trigger)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
