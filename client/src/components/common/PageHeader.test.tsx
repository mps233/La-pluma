// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PageHeader from './PageHeader'

vi.mock('framer-motion', () => ({
  motion: { div: 'div' },
  useReducedMotion: () => false,
}))

afterEach(cleanup)

describe('PageHeader mobile layout', () => {
  it('opts into a single mobile row without changing the default layout', () => {
    const { container, rerender } = render(
      <PageHeader title="控制台" actions={<button type="button">刷新</button>} mobileLayout="inline" />,
    )
    expect(container.querySelector('.app-page-header')?.classList.contains('is-mobile-inline')).toBe(true)
    expect(screen.getByRole('heading', { level: 1, name: '控制台' })).toBeTruthy()

    rerender(<PageHeader title="配置" actions={<button type="button">保存</button>} />)
    expect(container.querySelector('.app-page-header')?.classList.contains('is-mobile-inline')).toBe(false)
  })
})
