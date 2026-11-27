import { beforeEach, describe, expect, it } from 'vitest'
import { useMaaUpdateStore } from './maaUpdateStore'

describe('maaUpdateStore', () => {
  beforeEach(() => {
    useMaaUpdateStore.setState({ operation: null })
  })

  it('starts one running operation with its own token', () => {
    const first = useMaaUpdateStore.getState().begin('core', '下载 MaaCore')
    const second = useMaaUpdateStore.getState().begin('cli', '替换 CLI')

    expect(second).toBeGreaterThan(first)
    expect(useMaaUpdateStore.getState().operation).toMatchObject({
      token: second,
      kind: 'cli',
      state: 'running',
      detail: '替换 CLI',
      message: '',
    })
  })

  it('records the outcome with the server message', () => {
    const token = useMaaUpdateStore.getState().begin('resources', '拉取资源')
    useMaaUpdateStore.getState().finish(token, 'success', '资源文件更新成功')

    expect(useMaaUpdateStore.getState().operation).toMatchObject({
      state: 'success',
      message: '资源文件更新成功',
    })
    expect(useMaaUpdateStore.getState().operation?.finishedAt).toEqual(expect.any(Number))
  })

  it('ignores a late finish from an older operation', () => {
    const first = useMaaUpdateStore.getState().begin('core', '第一轮')
    const second = useMaaUpdateStore.getState().begin('core', '第二轮')
    useMaaUpdateStore.getState().finish(first, 'error', '旧请求失败')

    expect(useMaaUpdateStore.getState().operation?.detail).toBe('第二轮')
    expect(useMaaUpdateStore.getState().operation?.state).toBe('running')

    useMaaUpdateStore.getState().finish(second, 'error', '新请求失败')
    expect(useMaaUpdateStore.getState().operation?.message).toBe('新请求失败')
  })

  it('only clears the operation its token names', () => {
    const token = useMaaUpdateStore.getState().begin('core', '下载')
    useMaaUpdateStore.getState().clear(token + 1)
    expect(useMaaUpdateStore.getState().operation?.token).toBe(token)

    useMaaUpdateStore.getState().clear(token)
    expect(useMaaUpdateStore.getState().operation).toBeNull()
  })
})
