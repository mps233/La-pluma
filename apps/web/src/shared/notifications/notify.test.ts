import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  dismissNotice,
  EXECUTION_NOTICE_ID,
  notify,
  notifyProgress,
  STATISTICS_NOTICE_ID,
} from './notify'
import { detectNoticeType } from './noticeType'

const toastMock = vi.hoisted(() => {
  const base = vi.fn((_message: string, _options?: unknown) => 'toast-default')
  return Object.assign(base, {
    success: vi.fn((_message: string, _options?: unknown) => 'toast-success'),
    error: vi.fn((_message: string, _options?: unknown) => 'toast-error'),
    warning: vi.fn((_message: string, _options?: unknown) => 'toast-warning'),
    info: vi.fn((_message: string, _options?: unknown) => 'toast-info'),
    loading: vi.fn((_message: string, _options?: unknown) => 'toast-loading'),
    dismiss: vi.fn(),
  })
})

vi.mock('sonner', () => ({ toast: toastMock }))

describe('notify', () => {
  beforeEach(() => {
    toastMock.mockClear()
    toastMock.success.mockClear()
    toastMock.error.mockClear()
    toastMock.warning.mockClear()
    toastMock.info.mockClear()
    toastMock.loading.mockClear()
    toastMock.dismiss.mockClear()
  })

  it('infers success notices and uses the success lifetime', () => {
    expect(notify('配置已保存')).toBe('toast-success')
    expect(toastMock.success).toHaveBeenCalledWith('配置已保存', { duration: 2500 })
  })

  it('keeps errors visible until they are dismissed', () => {
    expect(notify('连接失败', 'error')).toBe('toast-error')
    expect(toastMock.error).toHaveBeenCalledWith('连接失败', { duration: Infinity })
  })

  it('lets an explicit type override the inferred one', () => {
    notify('操作完成', 'warning')

    expect(toastMock.warning).toHaveBeenCalledWith('操作完成', { duration: 4000 })
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it('uses the info lifetime for notices without a stronger signal', () => {
    notify('后台正在准备', 'info')
    notify('系统消息')

    expect(toastMock.info).toHaveBeenCalledWith('后台正在准备', { duration: 4000 })
    expect(toastMock).toHaveBeenCalledWith('系统消息', { duration: 4000 })
  })

  it('replaces an existing toast when a fixed id is supplied', () => {
    notify('已更新', 'success', { id: EXECUTION_NOTICE_ID })

    expect(toastMock.success).toHaveBeenCalledWith('已更新', {
      id: 'execution',
      duration: 2500,
    })
  })

  it('shows progress as a persistent loading toast with a fixed id', () => {
    expect(notifyProgress('正在执行任务...', EXECUTION_NOTICE_ID)).toBe('toast-loading')
    expect(toastMock.loading).toHaveBeenCalledWith('正在执行任务...', {
      id: 'execution',
      duration: Infinity,
    })
  })

  it('dismisses one notice or every notice', () => {
    dismissNotice(STATISTICS_NOTICE_ID)
    dismissNotice()

    expect(toastMock.dismiss).toHaveBeenNthCalledWith(1, 'statistics')
    expect(toastMock.dismiss).toHaveBeenNthCalledWith(2, undefined)
  })

  it('honors a custom duration', () => {
    notify('稍后消失', 'info', { duration: 1000 })

    expect(toastMock.info).toHaveBeenCalledWith('稍后消失', { duration: 1000 })
  })

  it('ignores empty messages', () => {
    expect(notify('')).toBe('')
    expect(notifyProgress('', EXECUTION_NOTICE_ID)).toBe('')
    expect(toastMock.success).not.toHaveBeenCalled()
    expect(toastMock.loading).not.toHaveBeenCalled()
    expect(toastMock).not.toHaveBeenCalled()
  })
})

describe('detectNoticeType', () => {
  it('does not classify an existing schedule time as success', () => {
    expect(detectNoticeType('该执行时间已经存在')).toBe('error')
  })

  it('treats stopped and disabled states as warnings', () => {
    expect(detectNoticeType('服务已停止')).toBe('warning')
    expect(detectNoticeType('自动更新已禁用')).toBe('warning')
  })

  it('keeps explicit completion phrases successful', () => {
    expect(detectNoticeType('任务流程执行完成')).toBe('success')
    expect(detectNoticeType('配置已保存')).toBe('success')
  })

  it('classifies in-progress text as info and neutral text as default', () => {
    expect(detectNoticeType('正在获取作业信息...')).toBe('info')
    expect(detectNoticeType('作业队列')).toBe('default')
    expect(detectNoticeType('')).toBe('default')
  })
})
