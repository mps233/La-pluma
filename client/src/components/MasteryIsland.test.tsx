// @vitest-environment jsdom

import { useEffect } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MasteryIsland from './MasteryIsland'
import { useMasteryStore } from '@/store/masteryStore'
import type { MasteryQueueItem, MasteryQueueStatus } from '@/types/components'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  update: vi.fn(),
  end: vi.fn(),
  expand: vi.fn(),
  collapse: vi.fn(),
}))

vi.mock('@/lib/island', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/island')>()),
  useIslandActions: () => ({
    start: mocks.start,
    update: mocks.update,
    end: mocks.end,
    expand: mocks.expand,
    collapse: mocks.collapse,
  }),
}))

vi.mock('@/hooks/useThemeAccent', () => ({ useThemeAccent: () => '#0a84ff' }))

vi.mock('@/components/islandcn/use-activity', () => ({
  useActivity: (build: () => { id: string }, deps: readonly unknown[]) => {
    const options = build()
    useEffect(() => {
      mocks.start(options)
      return () => mocks.end(options.id)
      // eslint-disable-next-line react-hooks/exhaustive-deps -- mirrors the kit.
    }, [options.id])
    useEffect(() => {
      mocks.update(options.id, options)
      // eslint-disable-next-line react-hooks/exhaustive-deps -- mirrors the kit.
    }, [options.id, JSON.stringify(deps)])
    return { id: options.id, alert: vi.fn(), expand: vi.fn(), collapse: vi.fn() }
  },
}))

vi.mock('@/components/islandcn/glyph', () => ({ Glyph: () => null }))
vi.mock('@/components/islandcn/glyphs', () => ({
  CheckCircleGlyph: () => null,
  SparkleGlyph: () => null,
  WarningGlyph: () => null,
}))
vi.mock('@/components/islandcn/island-layout', () => ({
  ExpandedBottom: ({ children }: { children?: unknown }) => children,
  SensorRow: ({ children }: { children?: unknown }) => children,
}))
vi.mock('@/components/islandcn/island-text', () => ({
  Caption: ({ children }: { children?: unknown }) => children,
  CompactText: ({ children }: { children?: unknown }) => children,
  ContextLabel: ({ children }: { children?: unknown }) => children,
  ExpandedSubtitle: ({ children }: { children?: unknown }) => children,
  ExpandedTitle: ({ children }: { children?: unknown }) => children,
  MinimalPair: () => null,
  withBubble: (compact: unknown) => compact,
}))
vi.mock('@/components/islandcn/media-row', () => ({
  MediaLead: ({ children }: { children?: unknown }) => children,
  MediaText: () => null,
  MediaTrail: ({ children }: { children?: unknown }) => children,
  SharePicture: () => null,
  ShareRing: () => null,
  mediaRow: { lead: 50, ring: 48 },
}))
vi.mock('@/components/islandcn/progress-ring', () => ({ IconRing: () => null }))

const item = (patch: Partial<MasteryQueueItem> = {}): MasteryQueueItem => ({
  id: 'char_test:1',
  operatorId: 'char_test',
  operatorName: '测试干员',
  role: 'Caster',
  skillIndex: 1,
  skillId: 'skchr_test_1',
  skillName: '测试技能一',
  targetLevel: 3,
  declaredLevel: 0,
  confirmedLevel: 1,
  levelVerified: true,
  startedLevel: 2,
  phase: 'training',
  enabled: true,
  order: 1,
  verifyCount: 1,
  attempts: 1,
  consecutiveFailures: 0,
  lastErrorCode: null,
  lastOutcome: null,
  trainingStartedAt: '2026-11-21T00:00:00.000Z',
  nextProbeAt: '2026-11-21T01:00:00.000Z',
  probeBackoffIndex: 0,
  blocked: null,
  activeRunId: null,
  lastRunId: null,
  recovery: null,
  addedAt: '2026-11-21T00:00:00.000Z',
  updatedAt: '2026-11-21T00:00:00.000Z',
  completedAt: null,
  skippedAt: null,
  ...patch,
})

const runningStatus = (patch: Partial<MasteryQueueStatus> = {}): MasteryQueueStatus => {
  const active = item()
  return {
    campaign: {
      status: 'running',
      activeItemId: active.id,
      activeStepRunId: null,
      settings: {
        probeIntervalMinutes: 60,
        onItemBlocked: 'skip',
        autoStartGame: true,
        notifyOnComplete: true,
        notifyOnBlocked: true,
      },
      clientProfileId: 'default',
      clientType: 'Official',
      startedAt: '2026-11-21T00:00:00.000Z',
      pausedReason: null,
      updatedAt: '2026-11-21T00:00:00.000Z',
    },
    items: [active],
    counts: { total: 1, queued: 0, training: 1, blocked: 0, completed: 0 },
    activeItem: active,
    nextActionableItem: active,
    ...patch,
  }
}

afterEach(() => {
  cleanup()
  useMasteryStore.getState().reset()
  vi.clearAllMocks()
})

describe('MasteryIsland', () => {
  it('stays out of the island when no campaign is active', () => {
    render(<MasteryIsland />)
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('reports a running mastery campaign with its progress', () => {
    useMasteryStore.getState().applyStatus(runningStatus())
    render(<MasteryIsland />)

    expect(mocks.start).toHaveBeenCalledOnce()
    const options = mocks.start.mock.calls[0]?.[0]
    expect(options).toMatchObject({
      id: 'la-pluma-mastery',
      priority: 1,
    })
    expect(options?.label).toContain('测试干员 · 测试技能一')
    expect(options?.label).toContain('已确认 33%')
  })

  it('shows a short completion outcome after the campaign ends', () => {
    useMasteryStore.getState().applyStatus(runningStatus())
    render(<MasteryIsland />)
    mocks.start.mockClear()

    act(() => {
      useMasteryStore.getState().applyStatus(runningStatus({
        campaign: { ...runningStatus().campaign, status: 'completed' },
      }))
      useMasteryStore.getState().setLastOutcome({ status: 'completed', at: Date.now(), message: '所有专精目标已处理完成' })
    })

    // The activity remounts with the outcome content because the campaign key changed.
    const labels = mocks.start.mock.calls.map(call => call[0]?.label as string | undefined)
    expect(labels.some(label => label?.includes('专精队列已完成'))).toBe(true)
    expect(labels.some(label => label?.includes('所有专精目标已处理完成'))).toBe(true)
  })
})
