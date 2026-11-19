// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Tooltip from './Tooltip'

afterEach(cleanup)

describe('Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('opens after the hover delay and closes on Escape', () => {
    render(
      <Tooltip content="安装 La Pluma">
        <button type="button" aria-label="安装 La Pluma">安装</button>
      </Tooltip>,
    )

    const trigger = screen.getByRole('button', { name: '安装 La Pluma' })
    expect(trigger).not.toBeNull()

    fireEvent.pointerOver(trigger, { relatedTarget: null })
    expect(screen.queryByRole('tooltip')).toBeNull()

    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(screen.getByRole('tooltip').textContent).toBe('安装 La Pluma')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('opens immediately on focus', () => {
    render(
      <Tooltip content="提示">
        <button type="button">焦点</button>
      </Tooltip>,
    )

    fireEvent.focusIn(screen.getByRole('button', { name: '焦点' }))

    expect(screen.getByRole('tooltip').textContent).toBe('提示')
  })

  it('does not render when disabled', () => {
    render(
      <Tooltip content="提示" disabled>
        <button type="button">禁用</button>
      </Tooltip>,
    )

    fireEvent.focusIn(screen.getByRole('button', { name: '禁用' }))
    act(() => {
      vi.advanceTimersByTime(400)
    })

    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
