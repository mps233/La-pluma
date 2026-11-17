import { describe, expect, it } from 'vitest'
import { fitDropItems } from './dropItemFit'

const measure = (text: string) => text.length

describe('fitDropItems', () => {
  it('keeps every whole item when the full list fits', () => {
    expect(fitDropItems(['aaa', 'bb', 'c'], 8, measure)).toEqual({
      visible: ['aaa', 'bb', 'c'],
      truncated: false,
    })
  })

  it('drops the next item entirely instead of clipping it', () => {
    expect(fitDropItems(['aaa', 'bb', 'c'], 7, measure)).toEqual({
      visible: ['aaa'],
      truncated: true,
    })
  })

  it('reserves the separator before the ellipsis', () => {
    expect(fitDropItems(['aaa', 'bb'], 5, measure)).toEqual({
      visible: ['aaa'],
      truncated: true,
    })
    expect(fitDropItems(['aaa', 'bb'], 4, measure)).toEqual({
      visible: [],
      truncated: true,
    })
  })

  it('renders only the ellipsis when even the first item cannot fit', () => {
    expect(fitDropItems(['aaa', 'bb'], 3, measure)).toEqual({
      visible: [],
      truncated: true,
    })
  })

  it('does not mark an empty list as truncated', () => {
    expect(fitDropItems([], 100, measure)).toEqual({
      visible: [],
      truncated: false,
    })
  })
})
