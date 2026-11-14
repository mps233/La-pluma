// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigFieldInput } from './ConfigFieldControls'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('ConfigFieldInput', () => {
  it('defaults browser autofill off while allowing an explicit override', async () => {
    await act(async () => {
      root.render(<ConfigFieldInput id="refresh-interval" label="刷新间隔" value="" onChange={() => undefined} />)
    })
    expect(container.querySelector('input')?.getAttribute('autocomplete')).toBe('off')

    await act(async () => {
      root.render(
        <ConfigFieldInput
          id="refresh-interval"
          label="刷新间隔"
          value=""
          autoComplete="on"
          onChange={() => undefined}
        />,
      )
    })
    expect(container.querySelector('input')?.getAttribute('autocomplete')).toBe('on')
  })
})
