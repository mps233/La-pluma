// @vitest-environment jsdom

import type { ReactNode } from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MasteryTrainingWorkspace from './MasteryTrainingWorkspace'
import type { MasteryCandidate, MasteryOperatorDetail, MasteryQueueItem, MasteryQueueStatus } from '@/types/components'

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
  getSklandStatus: vi.fn(),
  getSklandSnapshot: vi.fn(),
  saveSklandCredentials: vi.fn(),
  loginSkland: vi.fn(),
  syncSkland: vi.fn(),
  clearSklandCredentials: vi.fn(),
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
  getSklandStatus: mocks.getSklandStatus,
  getSklandSnapshot: mocks.getSklandSnapshot,
  saveSklandCredentials: mocks.saveSklandCredentials,
  loginSkland: mocks.loginSkland,
  syncSkland: mocks.syncSkland,
  clearSklandCredentials: mocks.clearSklandCredentials,
  getItemIconUrl: mocks.getItemIconUrl,
}))

vi.mock('../../services/operatorQuotes', () => ({
  getOperatorAvatarUrl: (id: string) => `/avatars/${id}.png`,
}))

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

const queuedItem: MasteryQueueItem = {
  id: 'char_test:1',
  operatorId: 'char_test',
  operatorName: '测试干员',
  role: 'Caster',
  skillIndex: 1,
  skillId: 'skchr_test_1',
  skillName: '测试技能一',
  targetLevel: 3,
  declaredLevel: 0,
  confirmedLevel: 0,
  levelVerified: false,
  startedLevel: null,
  phase: 'queued',
  enabled: true,
  order: 1,
  verifyCount: 0,
  attempts: 0,
  consecutiveFailures: 0,
  lastErrorCode: null,
  lastOutcome: null,
  trainingStartedAt: null,
  nextProbeAt: null,
  probeBackoffIndex: 0,
  blocked: null,
  activeRunId: null,
  lastRunId: null,
  recovery: null,
  addedAt: '2026-11-07T00:00:00.000Z',
  updatedAt: '2026-11-07T00:00:00.000Z',
  completedAt: null,
  skippedAt: null,
}

const secondQueuedItem: MasteryQueueItem = {
  ...queuedItem,
  id: 'char_test:2',
  skillIndex: 2,
  skillId: 'skchr_test_2',
  skillName: '测试技能二',
  order: 2,
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

const buildStatus = (items: MasteryQueueItem[]): MasteryQueueStatus => ({
  ...status,
  items,
  counts: { total: items.length, queued: items.length, training: 0, blocked: 0, completed: 0 },
  nextActionableItem: items[0] ?? null,
})

const renderWorkspace = () => render(<MasteryTrainingWorkspace />)

const findCandidateButton = () => screen.findByRole('button', { name: '测试干员，添加专精目标' })

beforeEach(() => {
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
  mocks.getSklandStatus.mockReset().mockResolvedValue({ success: true, data: { configured: false, characterCount: 0 } })
  mocks.getSklandSnapshot.mockReset().mockResolvedValue({
    success: true,
    data: { available: false, snapshot: { fetchedAt: '', uid: '', characters: [] } },
  })
  mocks.saveSklandCredentials.mockReset().mockResolvedValue({
    success: true,
    data: { configured: true, uid: 'uid-1', characterCount: 0 },
  })
  mocks.loginSkland.mockReset().mockResolvedValue({
    success: true,
    data: { configured: true, uid: 'uid-1', characterCount: 0 },
  })
  mocks.syncSkland.mockReset().mockResolvedValue({
    success: true,
    data: { configured: true, uid: 'uid-1', characterCount: 2 },
  })
  mocks.clearSklandCredentials.mockReset().mockResolvedValue({ success: true })
})

afterEach(cleanup)

describe('MasteryTrainingWorkspace', () => {
  it('shows synced mastery levels on cards and in the target dialog', async () => {
    const user = userEvent.setup({ delay: null })
    mocks.getSklandStatus.mockResolvedValue({
      success: true,
      data: { configured: true, uid: 'uid-1', nickname: 'Dr. Test', characterCount: 2, lastSyncedAt: '2026-11-17T00:00:00.000Z' },
    })
    mocks.getSklandSnapshot.mockResolvedValue({
      success: true,
      data: {
        available: true,
        snapshot: {
          fetchedAt: '2026-11-17T00:00:00.000Z',
          uid: 'uid-1',
          characters: [{
            id: 'char_test',
            name: '测试干员',
            evolvePhase: 2,
            level: 60,
            skills: [{ id: 'skchr_test_1', level: 2 }, { id: 'skchr_test_2', level: 0 }],
          }],
          training: null,
        },
      },
    })
    const view = renderWorkspace()
    await waitFor(() => expect(view.container.textContent).toContain('专精 1/2 · 最高 M2'))

    const candidateButton = await findCandidateButton()
    await user.click(candidateButton)
    await waitFor(() => expect(document.body.textContent).toContain('已专精 M2'))
  })

  it('renders the mastery picker and empty queue', async () => {
    const view = renderWorkspace()
    await findCandidateButton()
    await screen.findByText('还没有专精目标')

    expect(view.container.textContent).toContain('添加专精目标')
    expect(view.container.textContent).toContain('自动专精')
    expect(view.container.textContent).toContain('测试干员')
    expect(view.container.textContent).toContain('还没有专精目标')
  })

  it('marks a queued skill and asks before removing a target', async () => {
    const user = userEvent.setup({ delay: null })
    mocks.getMasteryStatus.mockResolvedValue({
      success: true,
      data: {
        ...status,
        items: [queuedItem],
        counts: { total: 1, queued: 1, training: 0, blocked: 0, completed: 0 },
        nextActionableItem: queuedItem,
      },
    })
    const view = renderWorkspace()

    const candidateButton = await findCandidateButton()
    await user.click(candidateButton)
    await waitFor(() => expect(document.body.textContent).toContain('等待执行 · M0→M3'))
    expect(view.container.textContent).toContain('受阻通知')

    const targetDialog = await screen.findByRole('dialog', { name: '设置专精目标' })
    await user.click(within(targetDialog).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '设置专精目标' })).toBeNull())

    const removeButton = await screen.findByRole('button', { name: '移除 测试干员 · 测试技能一' })
    await user.click(removeButton)
    expect(mocks.removeMasteryTarget).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('移除专精目标')

    const confirmDialog = await screen.findByRole('alertdialog', { name: '移除专精目标' })
    await user.click(within(confirmDialog).getByRole('button', { name: '移除目标' }))
    await waitFor(() => expect(mocks.removeMasteryTarget).toHaveBeenCalledWith('char_test:1'))
  })

  it('shows the preflight loading note instead of a failure', async () => {
    mocks.getMasteryPreflight.mockReturnValue(new Promise(() => {}))
    const view = renderWorkspace()
    await screen.findByText('还没有专精目标')

    expect(view.container.textContent).toContain('正在检查运行环境...')
    expect(view.container.textContent).not.toContain('专精运行前检查未通过')
  })

  it('opens the target dialog and adds a selected skill', async () => {
    const user = userEvent.setup({ delay: null })
    renderWorkspace()

    const candidateButton = await findCandidateButton()
    expect(candidateButton).toBeTruthy()

    await user.click(candidateButton)
    await waitFor(() => {
      expect(document.body.textContent).toContain('设置专精目标')
      expect(document.body.textContent).toContain('技能 1 · 测试技能一')
    })

    const targetDialog = await screen.findByRole('dialog', { name: '设置专精目标' })
    const addButton = within(targetDialog).getByRole('button', { name: /加入专精队列/ })
    expect(addButton).toBeTruthy()

    await user.click(addButton)
    await waitFor(() => expect(mocks.addMasteryTargets).toHaveBeenCalledTimes(1))

    const [items] = mocks.addMasteryTargets.mock.calls[0] as [Array<{ operatorId: string; skillIndex: number; targetLevel: number; declaredLevel: number }>]
    expect(items).toEqual([{ operatorId: 'char_test', skillIndex: 1, targetLevel: 3, declaredLevel: 0 }])
  })

  it('exposes a drag handle for every queue item', async () => {
    mocks.getMasteryStatus.mockResolvedValue({ success: true, data: buildStatus([queuedItem, secondQueuedItem]) })
    renderWorkspace()

    const firstHandle = await screen.findByLabelText('拖动排序 测试干员 · 测试技能一')
    const secondHandle = screen.getByLabelText('拖动排序 测试干员 · 测试技能二')

    expect(firstHandle.tagName).toBe('SPAN')
    expect(secondHandle.tagName).toBe('SPAN')
    expect(firstHandle.getAttribute('title')).toBe('拖动排序')
    expect(secondHandle.getAttribute('title')).toBe('拖动排序')
    expect(firstHandle.getAttribute('aria-disabled')).not.toBe('true')
    expect(secondHandle.getAttribute('aria-disabled')).not.toBe('true')
    expect(screen.getAllByLabelText(/^拖动排序 /)).toHaveLength(2)
  })

  it('keeps the up and down reorder buttons working', async () => {
    const user = userEvent.setup({ delay: null })
    const itemsById: Record<string, MasteryQueueItem> = {
      [queuedItem.id]: queuedItem,
      [secondQueuedItem.id]: secondQueuedItem,
    }
    let currentItems = [queuedItem, secondQueuedItem]
    mocks.getMasteryStatus.mockImplementation(async () => ({ success: true, data: buildStatus(currentItems) }))
    mocks.reorderMasteryTargets.mockImplementation(async (ids: string[]) => {
      currentItems = ids.flatMap((id, index) => {
        const item = itemsById[id]
        return item ? [{ ...item, order: index + 1 }] : []
      })
      return { success: true, data: { items: currentItems } }
    })
    renderWorkspace()

    const downButton = await screen.findByRole('button', { name: '下移 测试干员 · 测试技能一' })
    await user.click(downButton)
    await waitFor(() => expect(mocks.reorderMasteryTargets).toHaveBeenCalledWith(['char_test:2', 'char_test:1']))

    const upButton = await screen.findByRole('button', { name: '上移 测试干员 · 测试技能一' }) as HTMLButtonElement
    await waitFor(() => expect(upButton.disabled).toBe(false))
    await user.click(upButton)
    await waitFor(() => expect(mocks.reorderMasteryTargets).toHaveBeenLastCalledWith(['char_test:1', 'char_test:2']))
  })
})
