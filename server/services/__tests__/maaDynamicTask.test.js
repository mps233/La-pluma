import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mkdtemp, mkdir, writeFile, utimes, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanupStaleDynamicTaskFiles, execDynamicTask } from '../maaService.js'
import { MaaExecutionBusyError } from '../executionCoordinatorService.js'

function createRuntime({ background = false } = {}) {
  const events = []
  let settled = null
  let nonce = 0
  const runtime = {
    acquireExecutionLease: async owner => {
      events.push(['acquire', owner])
      return { release: async () => events.push(['release']) }
    },
    getConfigDir: async () => '/virtual/config',
    mkdir: async path => events.push(['mkdir', path]),
    writeFile: async (path, content) => events.push(['write', path, content]),
    unlink: async path => events.push(['unlink', path]),
    createNonce: () => `nonce_${++nonce}`,
    executeCommand: async (...args) => {
      events.push(['execute', ...args.slice(0, 6)])
      settled = args[6] || null
      return background ? { message: '任务已在后台启动' } : { stdout: 'ok' }
    }
  }
  return { events, runtime, getSettled: () => settled }
}

describe('dynamic task lifecycle', () => {
  it('locks before writing, uses a unique task id, and removes the file after a foreground run', async () => {
    const { events, runtime } = createRuntime()
    const result = await execDynamicTask(
      'award',
      { name: '领取奖励', type: 'Award', params: { award: true } },
      '领取奖励',
      'agent',
      true,
      false,
      runtime
    )

    assert.deepEqual(result, { stdout: 'ok' })
    assert.equal(events[0][0], 'acquire')
    const writeEvent = events.find(event => event[0] === 'write')
    const executeEvent = events.find(event => event[0] === 'execute')
    const runId = 'award_temp_nonce_1'
    assert.equal(executeEvent[2][0], '--batch')
    assert.equal(executeEvent[2][1], `_lapluma/${runId}`)
    assert.ok(writeEvent[1].endsWith(`/tasks/_lapluma/${runId}.json`))
    const writtenConfig = JSON.parse(writeEvent[2])
    assert.equal(writtenConfig.client_type, 'Official')
    assert.equal(writtenConfig.tasks[0].type, 'Award')
    assert.equal(writtenConfig.tasks[0].name, '领取奖励')
    assert.deepEqual(events.slice(-2).map(event => event[0]), ['unlink', 'release'])
  })

  it('keeps the task file and lease until a background process settles', async () => {
    const { events, runtime, getSettled } = createRuntime({ background: true })
    let releaseLifecycle
    let lifecycleFinished = false
    runtime.lifecycle = {
      onSettled: async outcome => {
        await new Promise(resolve => { releaseLifecycle = resolve })
        events.push(['lifecycle', outcome])
        lifecycleFinished = true
      }
    }
    await execDynamicTask('fight', { name: '理智作战', type: 'Fight', params: { stage: '1-7' } }, '理智作战', 'agent', false, false, runtime)

    assert.equal(events.some(event => event[0] === 'unlink'), false)
    assert.equal(events.some(event => event[0] === 'release'), false)
    assert.equal(typeof getSettled(), 'function')

    const settlement = getSettled()({ ok: true, result: { stdout: 'done' } })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(lifecycleFinished, false)
    assert.equal(typeof releaseLifecycle, 'function')

    releaseLifecycle()
    await settlement
    assert.deepEqual(events.slice(-3).map(event => event[0]), ['unlink', 'release', 'lifecycle'])
    assert.deepEqual(events.at(-1)[1], { ok: true, result: { stdout: 'done' } })
  })

  it('writes the resolved client type into the task file', async () => {
    const { events, runtime } = createRuntime()
    runtime.clientType = 'Bilibili'
    await execDynamicTask(
      'award',
      { name: '领取奖励', type: 'Award', params: { award: true } },
      '领取奖励',
      'agent',
      true,
      false,
      runtime
    )

    const writeEvent = events.find(event => event[0] === 'write')
    assert.equal(JSON.parse(writeEvent[2]).client_type, 'Bilibili')
  })

  it('rejects an unsupported client type before writing the task file', async () => {
    const { events, runtime } = createRuntime()
    runtime.clientType = 'InvalidServer'

    await assert.rejects(
      execDynamicTask('award', { name: '领取奖励', type: 'Award', params: {} }, '领取奖励', 'agent', true, false, runtime),
      error => error.code === 'MAA_CLIENT_TYPE_INVALID' && error.statusCode === 400
    )
    assert.equal(events.some(event => event[0] === 'write'), false)
  })

  it('does not collapse concurrent requests onto the same task file', async () => {
    const { events, runtime } = createRuntime()
    await Promise.all([
      execDynamicTask('award', { name: '奖励 A', type: 'Award', params: {} }, '奖励 A', 'agent', true, false, runtime),
      execDynamicTask('award', { name: '奖励 B', type: 'Award', params: {} }, '奖励 B', 'agent', true, false, runtime)
    ])

    const runIds = events.filter(event => event[0] === 'execute').map(event => event[2][1])
    assert.equal(new Set(runIds).size, 2)
  })

  it('removes only stale la-pluma task files during startup cleanup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'la-pluma-task-cleanup-'))
    const tasksDir = join(root, 'tasks')
    const dynamicDir = join(tasksDir, '_lapluma')
    await mkdir(dynamicDir, { recursive: true })

    const staleDynamic = join(dynamicDir, 'stale.json')
    const freshDynamic = join(dynamicDir, 'fresh.json')
    const staleLegacy = join(tasksDir, 'award_temp_old.toml')
    const userTask = join(tasksDir, 'user-task.toml')
    await Promise.all([
      writeFile(staleDynamic, ''),
      writeFile(freshDynamic, ''),
      writeFile(staleLegacy, ''),
      writeFile(userTask, '')
    ])

    const now = Date.now()
    await Promise.all([
      utimes(staleDynamic, new Date(now - 60_000), new Date(now - 60_000)),
      utimes(staleLegacy, new Date(now - 60_000), new Date(now - 60_000)),
      utimes(freshDynamic, new Date(now), new Date(now)),
      utimes(userTask, new Date(now - 60_000), new Date(now - 60_000))
    ])

    try {
      const removed = await cleanupStaleDynamicTaskFiles({ configDir: root, now, maxAgeMs: 30_000 })
      assert.equal(removed, 2)
      await assert.rejects(stat(staleDynamic), error => error.code === 'ENOENT')
      await assert.rejects(stat(staleLegacy), error => error.code === 'ENOENT')
      assert.equal((await stat(freshDynamic)).isFile(), true)
      assert.equal((await stat(userTask)).isFile(), true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('preserves a busy execution error before any task file is written', async () => {
    const busy = new MaaExecutionBusyError({ taskName: '仓库识别' })
    const { events, runtime } = createRuntime()
    runtime.acquireExecutionLease = async () => { throw busy }

    await assert.rejects(
      execDynamicTask('award', { name: '领取奖励', type: 'Award', params: {} }, '领取奖励', 'agent', true, false, runtime),
      error => error === busy && error.statusCode === 409 && error.retryable === true
    )
    assert.equal(events.some(event => event[0] === 'write'), false)
  })
})
