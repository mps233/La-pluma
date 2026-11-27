import { describe, expect, it } from 'vitest'

import {
  FOLD_DISTANCE,
  FOLD_LATCH_MS,
  FOLD_TOP_OPEN,
  createFoldTracker,
  sampleFold,
  type FoldScrollSample,
} from './useTabBarFold'

const viewportHeight = 800
const maxScrollTop = 2000

function sample(scrollTop: number): FoldScrollSample {
  return { scrollTop, maxScrollTop, viewportHeight }
}

function scrollTo(tracker: ReturnType<typeof createFoldTracker>, tops: number[], now: number, canFold = true) {
  return tops.reduce((state, top) => sampleFold(state, sample(top), now, canFold), tracker)
}

describe('tab bar fold tracker', () => {
  it('folds after eight pixels of downward travel', () => {
    const tracker = scrollTo(createFoldTracker(), [0, 4, 8], 1000)
    expect(tracker.folded).toBe(true)
  })

  it('ignores movement shorter than the threshold', () => {
    const tracker = scrollTo(createFoldTracker(), [0, 4, 7], 1000)
    expect(tracker.folded).toBe(false)
  })

  it('opens after eight pixels of upward travel', () => {
    const folded = scrollTo(createFoldTracker(), [100, 104, 108], 1000)
    const deeper = sampleFold(folded, sample(400), 1000 + FOLD_LATCH_MS, true)
    const opened = scrollTo(deeper, [396, 392], 1000 + FOLD_LATCH_MS)
    expect(opened.folded).toBe(false)
  })

  it('opens at the top even during the fold latch', () => {
    const folded = scrollTo(createFoldTracker(), [100, 104, 108], 1000)
    const atTop = sampleFold(folded, sample(0), 1000, true)
    expect(atTop.folded).toBe(false)

    const nearTop = sampleFold(folded, sample(FOLD_TOP_OPEN), 1000, true)
    expect(nearTop.folded).toBe(false)
  })

  it('opens as soon as a folded bar is within 48 px of the top', () => {
    const folded = scrollTo(createFoldTracker(), [100, 108, 116], 1000)
    expect(folded.folded).toBe(true)
    const opened = sampleFold(folded, sample(FOLD_TOP_OPEN), 1000 + FOLD_LATCH_MS, true)
    expect(opened.folded).toBe(false)
  })

  it('holds a new state for longer than its animation', () => {
    const folded = scrollTo(createFoldTracker(), [0, 4, 8], 1000)
    const tooSoon = scrollTo(folded, [300, 292, 284], 1000 + FOLD_LATCH_MS - 1)
    expect(tooSoon.folded).toBe(true)
  })

  it('ignores a jump of more than one screen', () => {
    const tracker = sampleFold(createFoldTracker(), sample(viewportHeight + 200), 1000, true)
    expect(tracker.folded).toBe(false)
    expect(tracker.travel).toBe(0)
  })

  it('ignores the bounce past either end', () => {
    const atTop = sampleFold(createFoldTracker(), sample(0), 1000, true)
    expect(atTop.folded).toBe(false)
    const atBottom = sampleFold(createFoldTracker(), sample(maxScrollTop), 1000, true)
    expect(atBottom.folded).toBe(false)
  })

  it('does not fold while the bar holds keyboard focus', () => {
    const tracker = scrollTo(createFoldTracker(), [0, 4, 8], 1000, false)
    expect(tracker.folded).toBe(false)
  })

  it('uses the same distance constant for both directions', () => {
    expect(FOLD_DISTANCE).toBe(8)
  })
})
