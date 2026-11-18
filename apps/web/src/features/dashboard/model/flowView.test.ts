import { describe, expect, it } from 'vitest'
import { buildDashboardFlowView, type DashboardFlowViewInput } from './flowView'

const base: DashboardFlowViewInput = {
  automationAvailable: true,
  connectionChecking: false,
  quickStartLoading: false,
  deviceBusy: false,
  phase: 'idle',
  runLabel: null,
  runDetail: null,
  currentTask: null,
  scheduleMessage: null,
  observationError: null,
}

const view = (overrides: Partial<DashboardFlowViewInput> = {}) => buildDashboardFlowView({ ...base, ...overrides })

describe('buildDashboardFlowView', () => {
  it('shows the ready state and enables both entries while idle', () => {
    expect(view()).toMatchObject({
      isRunning: false,
      controlsDisabled: false,
      commandTitle: '准备就绪',
      commandDescription: '设备待命，可以开始日常任务',
      primaryActionLabel: '开始',
    })
  })

  it('uses the schedule message as the idle description and leaves the title generic', () => {
    const result = view({ scheduleMessage: '上次执行成功' })
    expect(result.commandTitle).toBe('准备就绪')
    expect(result.commandDescription).toBe('上次执行成功')
  })

  it('projects a running run from the execution snapshot', () => {
    const result = view({ phase: 'running', runLabel: '正在执行: 收取信用', runDetail: '第 2 步' })
    expect(result).toMatchObject({
      isRunning: true,
      commandTitle: '正在执行: 收取信用',
      commandDescription: '第 2 步',
      primaryActionLabel: '正在运行',
    })
  })

  it('falls back through current task, schedule message and default while running', () => {
    expect(view({ phase: 'running', currentTask: '基建换班' }).commandTitle).toBe('基建换班')
    expect(view({ phase: 'running' }).commandTitle).toBe('流程执行中')
    expect(view({ phase: 'running', scheduleMessage: '计划推进中' }).commandDescription).toBe('计划推进中')
    expect(view({ phase: 'running' }).commandDescription).toBe('自动化任务正在按计划推进')
  })

  it('keeps the waiting state as a running phase with its own copy', () => {
    const result = view({ phase: 'waiting' })
    expect(result).toMatchObject({
      isRunning: true,
      commandTitle: '等待继续',
      commandDescription: '作业集等待下一关，请回到发起页面继续或停止',
      primaryActionLabel: '等待继续',
    })
  })

  it('reports unmanaged occupancy and unknown observation separately', () => {
    expect(view({ phase: 'occupied' })).toMatchObject({
      commandTitle: '设备被其他任务占用',
      commandDescription: '设备被未纳管的执行占用，等待结束后再开始',
    })
    expect(view({ phase: 'unknown', observationError: '网络中断' })).toMatchObject({
      commandTitle: '执行状态未知',
      commandDescription: '网络中断',
    })
    expect(view({ phase: 'unknown' }).commandDescription)
      .toBe('暂时无法确认执行状态，恢复连接后会自动刷新')
  })

  it('prioritizes the starting state over the execution phase', () => {
    const quickStart = view({ quickStartLoading: true, phase: 'waiting' })
    expect(quickStart).toMatchObject({
      controlsDisabled: true,
      commandTitle: '正在启动今日流程',
      commandDescription: '正在读取任务配置并提交执行',
    })
  })

  it('shows a short connection block and disables the entries when automation is unavailable', () => {
    const result = view({
      automationAvailable: false,
      phase: 'running',
    })
    expect(result).toMatchObject({
      isRunning: true,
      controlsDisabled: true,
      commandTitle: '连接不可用',
      commandDescription: '连接恢复后可以继续操作',
    })
  })

  it('distinguishes an in-progress connection check from an unavailable connection', () => {
    const result = view({
      automationAvailable: false,
      connectionChecking: true,
      phase: 'running',
    })
    expect(result).toMatchObject({
      controlsDisabled: true,
      commandTitle: '正在检查服务',
      commandDescription: '正在确认自动化服务状态',
    })
  })

  it('disables the entries while the device is busy', () => {
    expect(view({ deviceBusy: true })).toMatchObject({
      controlsDisabled: true,
      commandTitle: '准备就绪',
    })
  })
})
