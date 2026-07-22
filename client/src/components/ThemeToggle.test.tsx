// @vitest-environment jsdom

import { act, forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/stores'
import ThemeToggle from './ThemeToggle'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

let container: HTMLDivElement
let root: Root

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

describe('ThemeToggle mobile menu', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn(mediaQueryList)
    window.requestAnimationFrame = vi.fn(callback => {
      callback(0)
      return 1
    })
    window.cancelAnimationFrame = vi.fn()
    useUIStore.getState().setTheme('system')
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('opens an anchored radio menu and applies the selected theme', async () => {
    await act(async () => root.render(<ThemeToggle />))
    const trigger = container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!

    await act(async () => trigger.click())
    const menu = container.querySelector<HTMLElement>('[role="menu"]')!
    const selectedOption = menu.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')
    expect(selectedOption?.textContent).toContain('跟随系统')
    expect(document.activeElement).toBe(selectedOption)

    const lightOption = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
      .find(option => option.textContent?.includes('亮色模式'))!
    await act(async () => lightOption.click())

    expect(useUIStore.getState().theme).toBe('light')
    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('keeps the desktop segmented control and store selection in sync', async () => {
    await act(async () => root.render(<ThemeToggle />))

    const group = container.querySelector<HTMLElement>('.la-pluma-theme-desktop[role="group"][aria-label="界面主题"]')!
    const buttons = Array.from(group.querySelectorAll<HTMLButtonElement>('button'))

    expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual([
      '亮色模式',
      '暗色模式',
      '跟随系统',
    ])
    expect(buttons.every(button => button.type === 'button')).toBe(true)
    expect(group.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(3)
    expect(buttons.filter(button => button.getAttribute('aria-pressed') === 'true')).toEqual([buttons[2]])
    expect(group.dataset.theme).toBe('system')

    await act(async () => buttons[0]?.click())

    expect(useUIStore.getState().theme).toBe('light')
    expect(group.dataset.theme).toBe('light')
    expect(buttons.filter(button => button.getAttribute('aria-pressed') === 'true')).toEqual([buttons[0]])
  })

  it('closes with Escape and restores focus to the trigger', async () => {
    await act(async () => root.render(<ThemeToggle />))
    const trigger = container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!
    await act(async () => trigger.click())

    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))

    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('moves through options with arrow keys and closes when tabbing away', async () => {
    await act(async () => root.render(
      <div className="la-pluma-navbar-actions">
        <ThemeToggle />
        <a href="https://github.com/mps233/La-pluma" className="la-pluma-github-link">GitHub</a>
      </div>,
    ))
    const trigger = container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!
    const githubLink = container.querySelector<HTMLAnchorElement>('.la-pluma-github-link')!
    await act(async () => trigger.click())

    const options = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
    expect(document.activeElement).toBe(options[2])

    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    expect(document.activeElement).toBe(options[0])

    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
    expect(document.activeElement).toBe(options[2])

    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })))
    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(githubLink)

    await act(async () => trigger.click())
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })))
    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
