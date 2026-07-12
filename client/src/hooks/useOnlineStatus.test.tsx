// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useOnlineStatus } from './useOnlineStatus'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let online = true
let container: HTMLDivElement
let root: Root

function Harness() {
  const isOnline = useOnlineStatus()
  return <div>{isOnline ? 'online' : 'offline'}</div>
}

describe('useOnlineStatus', () => {
  beforeEach(() => {
    online = true
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => online,
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('tracks browser offline and online events', async () => {
    await act(async () => root.render(<Harness />))
    expect(container.textContent).toBe('online')

    online = false
    act(() => window.dispatchEvent(new Event('offline')))
    expect(container.textContent).toBe('offline')

    online = true
    act(() => window.dispatchEvent(new Event('online')))
    expect(container.textContent).toBe('online')
  })
})
