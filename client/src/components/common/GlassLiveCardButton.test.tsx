// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const seen = vi.hoisted(() => [] as boolean[])

vi.mock('@/components/glass', () => ({
  GlassCard: ({ live, children }: { live?: boolean; children?: React.ReactNode }) => {
    seen.push(Boolean(live))
    return <div>{children}</div>
  },
}))

vi.mock('@/hooks/useCoarsePointer', () => ({
  useCoarsePointer: () => false,
}))

import GlassLiveCardButton from './GlassLiveCardButton'

afterEach(cleanup)

describe('GlassLiveCardButton', () => {
  it('keeps per-frame live repaint opt-in', () => {
    render(<GlassLiveCardButton>Static chrome</GlassLiveCardButton>)
    expect(seen.at(-1)).toBe(false)

    cleanup()
    render(<GlassLiveCardButton live>Moving content</GlassLiveCardButton>)
    expect(seen.at(-1)).toBe(true)
  })
})
