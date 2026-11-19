// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Card, CardContent, CardHeader } from './Card'
import SmoothPanel from './SmoothPanel'

afterEach(cleanup)

describe('Card continuous corners', () => {
  it('renders native card, header, and content elements by default', () => {
    const { container } = render(
      <Card>
        <CardHeader title="任务" />
        <CardContent>内容</CardContent>
      </Card>,
    )

    const card = container.querySelector('.app-card')
    expect(card?.tagName).toBe('DIV')
    expect(card?.classList.contains('card')).toBe(false)
    expect(card?.getAttribute('data-smooth-corners')).toBeNull()
    expect(card?.querySelector('.app-card-smooth-surface')).toBeNull()
    expect(card?.querySelector('.app-card-header')?.tagName).toBe('DIV')
    expect(card?.querySelector('.app-card-content')?.tagName).toBe('DIV')
  })

  it('adds an inner Lisse surface without replacing the card shell', () => {
    const { container } = render(<Card smoothCorners>内容</Card>)

    const card = container.querySelector('.app-card')
    const surface = card?.querySelector('.app-card-smooth-surface')
    expect(card?.getAttribute('data-smooth-corners')).toBe('true')
    expect(surface?.getAttribute('data-slot')).toBe('smooth-corners')
    expect(surface?.textContent).toBe('内容')
  })

  it('keeps compact panel shadows on a shell around the clipped surface', () => {
    const { container } = render(
      <SmoothPanel cornerSize="compact" className="outer" surfaceClassName="inner">
        设备状态
      </SmoothPanel>,
    )

    const panel = container.querySelector('.smooth-panel-shell')
    const surface = panel?.querySelector('.smooth-panel-surface')
    expect(panel?.classList.contains('smooth-panel-compact')).toBe(true)
    expect(panel?.classList.contains('surface-panel')).toBe(true)
    expect(panel?.getAttribute('data-smooth-corners')).toBe('true')
    expect(surface?.getAttribute('data-slot')).toBe('smooth-corners')
    expect(surface?.classList.contains('inner')).toBe(true)
    expect(surface?.textContent).toBe('设备状态')
  })
})
