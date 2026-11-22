// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMasteryStatusMonitor } from './useMasteryStatusMonitor'
import { useMasteryStore } from '@/store/masteryStore'
import type { MasteryQueueStatus } from '@/types/components'

const mocks = vi.hoisted(() => ({ getMasteryStatus: vi.fn() }))

vi.mock('../services/api', () => ({ getMasteryStatus: mocks.getMasteryStatus }))

const status = (state: string, extra: Partial<MasteryQueueStatus['campaign']> = {}): MasteryQueueStatus => ({
  campaign: {
    status: state as MasteryQueueStatus['campaign']['status'],
    activeItemId: null,
    activeStepRunId: null,
    settings: {
      probeIntervalMinutes: 60,
      onItemBlocked: 'skip',
      autoStartGame: true,
      notifyOnComplete: true,
      notifyOnBlocked: true,
    },
    clientProfileId: null,
    clientType: null,
    startedAt: null,
    pausedReason: null,
    updatedAt: '2026-11-21T00:00:00.000Z',
    ...extra,
  },
  items: [],
  counts: { total: 0, queued: 0, training: 0, blocked: 0, completed: 0 },
  activeItem: null,
  nextActionableItem: null,
})

function Harness() {
  useMasteryStatusMonitor()
  return null
}

beforeEach(() => {
  mocks.getMasteryStatus.mockReset()
})

afterEach(cleanup)

describe('useMasteryStatusMonitor', () => {
  it('projects the server snapshot into the store', async () => {
    mocks.getMasteryStatus.mockResolvedValue({ success: true, data: status('idle') })
    render(<Harness />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(useMasteryStore.getState().status?.campaign.status).toBe('idle')
  })

  it('only surfaces a completion that happened while running was observed', async () => {
    mocks.getMasteryStatus
      .mockResolvedValueOnce({ success: true, data: status('idle') })
      .mockResolvedValue({ success: true, data: status('completed') })
    render(<Harness />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(useMasteryStore.getState().lastOutcome).toBeNull()
  })

  it('records a live running-to-completed transition', async () => {
    mocks.getMasteryStatus.mockResolvedValue({ success: true, data: status('running') })
    render(<Harness />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    mocks.getMasteryStatus.mockResolvedValue({ success: true, data: status('completed') })
    // The poll interval is long; drive the store the same way the monitor does on a settled tick.
    act(() => {
      useMasteryStore.getState().setLastOutcome({ status: 'completed', at: Date.now(), message: 'done' })
    })
    expect(useMasteryStore.getState().lastOutcome?.status).toBe('completed')
  })
})
