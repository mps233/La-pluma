// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MasteryTrainingWorkspace from './MasteryTrainingWorkspace'
import type { MasteryCandidate, MasteryOperatorDetail, MasteryQueueStatus } from '@/types/components'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  getMasteryPreflight: vi.fn(),
  getMasteryCatalog: vi.fn(),
  getMasteryOperator: vi.fn(),
  getMasteryStatus: vi.fn(),
  addMasteryTargets: vi.fn(),
  updateMasteryTarget: vi.fn(),
  removeMasteryTarget: vi.fn(),
  reorderMasteryTargets: vi.fn(),
  updateMasterySettings: vi.fn(),
  startMasteryCampaign: vi.fn(),
  pauseMasteryCampaign: vi.fn(),
  resumeMasteryCampaign: vi.fn(),
  stopMasteryCampaign: vi.fn(),
  retryMasteryTarget: vi.fn(),
  getItemIconUrl: vi.fn((id: string | number) => `/items/${id}.png`),
}))

vi.mock('framer-motion', async () => {
  const React = await import('react')
  type MotionTestProps = Record<string, unknown> & { children?: ReactNode }
  const motionComponent = (tag: 'button' | 'div' | 'span') => React.forwardRef<HTMLElement, MotionTestProps>(
    ({ children, initial: _initial, animate: _animate, exit: _exit, transition: _transition, whileHover: _whileHover, whileTap: _whileTap, ...props }, ref) =>
      React.createElement(tag, { ...props, ref }, children as ReactNode),
  )
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: {
      button: motionComponent('button'),
      div: motionComponent('div'),
      span: motionComponent('span'),
    },
    useReducedMotion: () => true,
  }
})

vi.mock('../../services/api', () => ({
  addMasteryTargets: mocks.addMasteryTargets,
  getMasteryCatalog: mocks.getMasteryCatalog,
  getMasteryOperator: mocks.getMasteryOperator,
  getMasteryPreflight: mocks.getMasteryPreflight,
  getMasteryStatus: mocks.getMasteryStatus,
  pauseMasteryCampaign: mocks.pauseMasteryCampaign,
  removeMasteryTarget: mocks.removeMasteryTarget,
  reorderMasteryTargets: mocks.reorderMasteryTargets,
  resumeMasteryCampaign: mocks.resumeMasteryCampaign,
  retryMasteryTarget: mocks.retryMasteryTarget,
  startMasteryCampaign: mocks.startMasteryCampaign,
  stopMasteryCampaign: mocks.stopMasteryCampaign,
  updateMasterySettings: mocks.updateMasterySettings,
  getItemIconUrl: mocks.getItemIconUrl,
}))

vi.mock('../../services/operatorQuotes', () => ({
  getOperatorAvatarUrl: (id: string) => `/avatars/${id}.png`,
}))

let container: HTMLDivElement
let root: Root

const candidate: MasteryCandidate = {
  id: 'char_test',
  name: '测试干员',
  rarity: 6,
  profession: '术师',
  professionId: 'CASTER',
  currentElite: 2,
  currentLevel: 90,
  owned: true,
  ownedStateKnown: true,
  skillCount: 2,
  eligible: true,
  disabledReason: null,
}

const detail: MasteryOperatorDetail = {
  id: 'char_test',
  name: '测试干员',
  nameForMaa: '测试干员',
  role: 'Caster',
  rarity: 6,
  profession: '术师',
  professionId: 'CASTER',
  currentElite: 2,
  currentLevel: 90,
  owned: true,
  ownedStateKnown: true,
  clientType: 'Official',
  dataFreshness: {
    operbox: { timestamp: '2026-11-07T00:00:00.000Z', ageDays: 0 },
    depot: { timestamp: '2026-11-07T00:00:00.000Z', ageDays: 0 },
    mastery: { lastUpdated: '2026-11-07' },
  },
  skills: [
    {
      index: 1,
      skillId: 'skchr_test_1',
      name: '测试技能一',
      iconId: null,
      levels: [
        {
          level: 1,
          materials: [{ id: '3303', name: '技巧概要·卷3', count: 2 }],
          materialNodes: [{ id: '3303', name: '技巧概要·卷3', iconId: '3303', count: 2, have: 10, needed: 2, stillNeeded: 0 }],
        },
      ],
      nextLevel: {
        level: 1,
        materials: [{ id: '3303', name: '技巧概要·卷3', count: 2 }],
        materialNodes: [{ id: '3303', name: '技巧概要·卷3', iconId: '3303', count: 2, have: 10, needed: 2, stillNeeded: 0 }],
      },
      nextMaterialNodes: [{ id: '3303', name: '技巧概要·卷3', iconId: '3303', count: 2, have: 10, needed: 2, stillNeeded: 0 }],
    },
    {
      index: 2,
      skillId: 'skchr_test_2',
      name: '测试技能二',
      iconId: null,
      levels: [],
      nextLevel: null,
      nextMaterialNodes: [],
    },
  ],
}

const status: MasteryQueueStatus = {
  campaign: {
    status: 'idle',
    activeItemId: null,
    activeStepRunId: null,
    settings: {
      probeIntervalMinutes: 60,
      onItemBlocked: 'skip',
      autoStartGame: false,
      notifyOnComplete: true,
      notifyOnBlocked: true,
    },
    clientProfileId: null,
    clientType: null,
    startedAt: null,
    pausedReason: null,
    updatedAt: '2026-11-07T00:00:00.000Z',
  },
  items: [],
  counts: { total: 0, queued: 0, training: 0, blocked: 0, completed: 0 },
  activeItem: null,
  nextActionableItem: null,
  scheduler: { running: true, tickMs: 60_000, lastTickAt: null, lastTickError: null, tickInFlight: false },
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mocks.getMasteryPreflight.mockReset().mockResolvedValue({
    success: true,
    data: {
      supported: true,
      masteryData: { available: true, operatorCount: 454, error: null },
      clientType: 'Official',
      minimumMaaCliVersion: '0.7.8',
      minimumMaaCoreVersion: '6.21.4',
      runtime: {
        supported: true,
        cli: '0.7.8',
        core: '6.21.4',
        minimumCli: '0.7.8',
        minimumCore: '6.21.4',
        reason: null,
      },
    },
  })
  mocks.getMasteryStatus.mockReset().mockResolvedValue({ success: true, data: status })
  mocks.getMasteryCatalog.mockReset().mockResolvedValue({
    success: true,
    data: { operators: [candidate], total: 1, dataFreshness: {} },
  })
  mocks.getMasteryOperator.mockReset().mockResolvedValue({ success: true, data: detail })
  mocks.addMasteryTargets.mockReset().mockResolvedValue({ success: true, data: { items: [], added: 1 } })
  mocks.updateMasterySettings.mockReset().mockResolvedValue({ success: true, data: status.campaign.settings })
  mocks.startMasteryCampaign.mockReset().mockResolvedValue({ success: true, data: status })
  mocks.pauseMasteryCampaign.mockReset().mockResolvedValue({ success: true, data: status })
  mocks.resumeMasteryCampaign.mockReset().mockResolvedValue({ success: true, data: status })
  mocks.stopMasteryCampaign.mockReset().mockResolvedValue({ success: true, data: status })
  mocks.retryMasteryTarget.mockReset().mockResolvedValue({ success: true, data: null })
  mocks.removeMasteryTarget.mockReset().mockResolvedValue({ success: true })
  mocks.reorderMasteryTargets.mockReset().mockResolvedValue({ success: true, data: { items: [] } })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

async function settle() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('MasteryTrainingWorkspace', () => {
  it('renders the mastery picker and empty queue', async () => {
    await act(async () => {
      root.render(<MasteryTrainingWorkspace />)
    })
    await settle()

    expect(container.textContent).toContain('添加专精目标')
    expect(container.textContent).toContain('自动专精')
    expect(container.textContent).toContain('测试干员')
    expect(container.textContent).toContain('还没有专精目标')
  })

  it('opens the target dialog and adds a selected skill', async () => {
    await act(async () => {
      root.render(<MasteryTrainingWorkspace />)
    })
    await settle()

    const candidateButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.getAttribute('aria-label')?.includes('添加专精目标'))
    expect(candidateButton).toBeTruthy()

    await act(async () => {
      candidateButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle()

    expect(document.body.textContent).toContain('设置专精目标')
    expect(document.body.textContent).toContain('技能 1 · 测试技能一')

    const addButton = Array.from(document.querySelectorAll('button'))
      .find(button => button.textContent?.includes('加入专精队列'))
    expect(addButton).toBeTruthy()

    await act(async () => {
      addButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle()

    expect(mocks.addMasteryTargets).toHaveBeenCalledTimes(1)
    const [items] = mocks.addMasteryTargets.mock.calls[0] as [Array<{ operatorId: string; skillIndex: number; targetLevel: number; declaredLevel: number }>]
    expect(items).toEqual([{ operatorId: 'char_test', skillIndex: 1, targetLevel: 3, declaredLevel: 0 }])
  })
})