// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { buildDropSummary } from './dropSummary'

describe('buildDropSummary', () => {
  it('accumulates the same stage into one row with summed item counts', () => {
    const summary = buildDropSummary([
      {
        stage: 'TL-9',
        items: [
          { itemId: '4001', name: '龙门币', count: 1008 },
          { itemId: '4002', name: '失败的记录', count: 84 },
          { itemId: '4003', name: '电极单元', count: 2 },
        ],
      },
      {
        stage: 'TL-9',
        items: [
          { itemId: '4001', name: '龙门币', count: 1512 },
          { itemId: '4002', name: '失败的记录', count: 126 },
          { itemId: '4003', name: '电极单元', count: 4 },
        ],
      },
    ])

    expect(summary).toEqual({
      count: 2,
      items: '龙门币×2520、失败的记录×210、电极单元×6',
      recent: [{ stage: 'TL-9', items: '龙门币×2520、失败的记录×210、电极单元×6' }],
    })
  })

  it('keeps different stages on separate rows ordered by their latest drop', () => {
    const summary = buildDropSummary([
      { stage: 'CE-6', items: [{ name: '龙门币', count: 10 }] },
      { stage: 'AP-5', items: [{ name: '采购凭证', count: 2 }] },
      { stage: 'CE-6', items: [{ name: '龙门币', count: 5 }] },
    ])

    expect(summary).toEqual({
      count: 3,
      items: '龙门币×15、采购凭证×2',
      recent: [
        { stage: 'CE-6', items: '龙门币×15' },
        { stage: 'AP-5', items: '采购凭证×2' },
      ],
    })
  })

  it('unions different items of one stage and orders them by accumulated count', () => {
    const summary = buildDropSummary([
      { stage: '1-7', items: [{ name: '固源岩', count: 2 }] },
      { stage: '1-7', items: [{ name: '装置', count: 5 }] },
    ])

    expect(summary.items).toBe('装置×5、固源岩×2')
    expect(summary.recent).toEqual([{ stage: '1-7', items: '装置×5、固源岩×2' }])
  })

  it('keeps a single record unchanged', () => {
    expect(buildDropSummary([
      { stage: '1-7', items: [{ itemId: '30011', name: '固源岩', count: 4 }] },
    ])).toEqual({
      count: 1,
      items: '固源岩×4',
      recent: [{ stage: '1-7', items: '固源岩×4' }],
    })
  })

  it('falls back to the empty-detail placeholder when no record carries item detail', () => {
    expect(buildDropSummary([{ stage: 'AP-5' }, { stage: 'AP-5' }])).toEqual({
      count: 2,
      items: '已记录作战，暂无材料明细',
      recent: [{ stage: 'AP-5', items: '已记录作战，暂无材料明细' }],
    })
  })

  it('prefers item detail over the empty-detail placeholder within one stage', () => {
    const summary = buildDropSummary([
      { stage: '1-7' },
      { stage: '1-7', items: [{ name: '固源岩', count: 4 }] },
    ])
    expect(summary.items).toBe('固源岩×4')
    expect(summary.recent).toEqual([{ stage: '1-7', items: '固源岩×4' }])
  })

  it('merges items by item id instead of display name', () => {
    const summary = buildDropSummary([
      { stage: '1-7', items: [{ itemId: '30011', name: '固源岩', count: 2 }] },
      { stage: '1-7', items: [{ itemId: '30012', name: '固源岩', count: 3 }] },
      { stage: '1-7', items: [{ itemId: '30011', name: '源岩', count: 4 }] },
    ])

    expect(summary.items).toBe('固源岩×6、固源岩×3')
    expect(summary.recent).toEqual([{ stage: '1-7', items: '固源岩×6、固源岩×3' }])
  })

  it('keeps every distinct item of a stage', () => {
    const summary = buildDropSummary([
      {
        stage: '1-7',
        items: [
          { name: '固源岩', count: 9 },
          { name: '装置', count: 1 },
          { name: '破损装置', count: 1 },
          { name: '源岩', count: 1 },
        ],
      },
    ])

    expect(summary.items).toBe('固源岩×9、装置×1、破损装置×1、源岩×1')
    expect(summary.recent).toEqual([
      { stage: '1-7', items: '固源岩×9、装置×1、破损装置×1、源岩×1' },
    ])
  })

  it('limits the summary to the three most recently dropped stages', () => {
    const summary = buildDropSummary([
      { stage: 'S-1', items: [{ name: '材料', count: 1 }] },
      { stage: 'S-2', items: [{ name: '材料', count: 1 }] },
      { stage: 'S-3', items: [{ name: '材料', count: 1 }] },
      { stage: 'S-4', items: [{ name: '材料', count: 1 }] },
    ])

    expect(summary.count).toBe(4)
    expect(summary.items).toBe('材料×4')
    expect(summary.recent.map(row => row.stage)).toEqual(['S-4', 'S-3', 'S-2'])
  })

  it('uses the stage name fallbacks and the unknown-stage placeholder', () => {
    const summary = buildDropSummary([
      { stageName: '显示名', stageCode: 'SC-1', items: [{ name: '材料', count: 1 }] },
      { stageCode: 'SC-1', items: [{ name: '材料', count: 1 }] },
      { items: [{ name: '材料', count: 1 }] },
    ])

    expect(summary.items).toBe('材料×3')
    expect(summary.recent).toEqual([
      { stage: '未知关卡', items: '材料×1' },
      { stage: '显示名', items: '材料×2' },
    ])
  })
})
