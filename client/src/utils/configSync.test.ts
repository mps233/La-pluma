// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { createConfigSyncGate } from './configSync'

describe('createConfigSyncGate', () => {
  it('issues increasing tokens', () => {
    const gate = createConfigSyncGate()
    const first = gate.nextToken()
    const second = gate.nextToken()
    expect(first).not.toBe(second)
    expect(Number(second.split('-')[1])).toBeGreaterThan(Number(first.split('-')[1]))
  })

  it('tracks the pending token per key', () => {
    const gate = createConfigSyncGate()
    const key = 'test-config-sync'
    gate.markPending(key, 'token-1')
    expect(gate.pendingToken(key)).toBe('token-1')
    expect(gate.isCurrent(key, 'token-1')).toBe(true)
    expect(gate.isCurrent(key, 'token-2')).toBe(false)

    gate.clearPending(key)
    expect(gate.pendingToken(key)).toBeNull()
  })

  it('serializes operations and keeps running after a failure', async () => {
    const gate = createConfigSyncGate()
    const order: string[] = []
    let release!: () => void
    const first = gate.enqueue(async () => {
      order.push('first-start')
      await new Promise<void>(resolve => {
        release = resolve
      })
      order.push('first-end')
    })
    const second = gate.enqueue(async () => {
      order.push('second')
    })

    await Promise.resolve()
    expect(order).toEqual(['first-start'])
    release()
    await Promise.all([first, second])
    expect(order).toEqual(['first-start', 'first-end', 'second'])

    await expect(gate.enqueue(async () => {
      throw new Error('boom')
    })).rejects.toThrow('boom')
    await expect(gate.enqueue(async () => 'after')).resolves.toBe('after')
  })
})
