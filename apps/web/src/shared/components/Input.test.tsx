// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'

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

async function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('Input consumption contract', () => {
  it('reports typed values as they are entered and shows the placeholder before typing', async () => {
    const typed: string[] = []
    function Host() {
      const [value, setValue] = useState('')
      return (
        <Input
          aria-label="账号"
          value={value}
          placeholder="请输入账号"
          onChange={event => {
            typed.push(event.target.value)
            setValue(event.target.value)
          }}
        />
      )
    }

    await act(async () => root.render(<Host />))
    const input = container.querySelector('input')
    expect(input?.getAttribute('placeholder')).toBe('请输入账号')

    await typeInto(input!, 'la-pluma')
    expect(typed).toEqual(['la-pluma'])
    expect(input?.value).toBe('la-pluma')
  })

  it('marks invalid inputs and keeps describedby references intact', async () => {
    function Host({ error }: { error?: string }) {
      return (
        <Input
          aria-label="账号"
          value=""
          onChange={() => undefined}
          aria-invalid={error ? true : undefined}
          aria-errormessage={error ? 'account-error' : undefined}
          aria-describedby="account-help"
        />
      )
    }

    await act(async () => root.render(<Host />))
    const input = container.querySelector('input')
    expect(input?.getAttribute('aria-invalid')).toBeNull()
    expect(input?.getAttribute('aria-describedby')).toBe('account-help')

    await act(async () => root.render(<Host error="请输入账号" />))
    expect(input?.getAttribute('aria-invalid')).toBe('true')
    expect(input?.getAttribute('aria-errormessage')).toBe('account-error')
    expect(input?.getAttribute('aria-describedby')).toBe('account-help')
  })

  it('disables the field while disabled', async () => {
    await act(async () => {
      root.render(<Input aria-label="账号" value="v" disabled onChange={() => undefined} />)
    })
    const input = container.querySelector('input') as HTMLInputElement
    expect(input.disabled).toBe(true)
    expect(input.value).toBe('v')
  })
})

describe('Select consumption contract', () => {
  const SOURCES = [
    { value: 'local', label: '本地目录' },
    { value: 'git', label: 'Git 仓库' },
    { value: 'mirrorchyan', label: 'MirrorChyan' },
  ]

  function Host({ onValue }: { onValue: (value: string) => void }) {
    const [value, setValue] = useState<string | null>('git')
    return (
      <Select
        items={SOURCES}
        value={value}
        onValueChange={next => {
          if (next === null) return
          onValue(next)
          setValue(next)
        }}
      >
        <SelectTrigger aria-label="资源来源" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SOURCES.map(item => (
            <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  const optionByLabel = (label: string) =>
    [...document.querySelectorAll('[role="option"]')].find(node => node.textContent === label) as
      | HTMLElement
      | undefined

  const isSelectOpen = () => {
    const listbox = document.querySelector('[role="listbox"]')
    if (!listbox) return false
    return !listbox.parentElement?.hasAttribute('data-closed')
  }

  it('shows the selected item label in the trigger without opening the popup', async () => {
    const picked: string[] = []
    await act(async () => root.render(<Host onValue={value => picked.push(value)} />))

    const trigger = container.querySelector('[role="combobox"]')
    expect(trigger?.getAttribute('aria-expanded')).toBe('false')
    expect(trigger?.textContent).toContain('Git 仓库')
    expect(isSelectOpen()).toBe(false)
    expect(picked).toEqual([])
  })

  it('opens the popup on click and commits the chosen option', async () => {
    const picked: string[] = []
    await act(async () => root.render(<Host onValue={value => picked.push(value)} />))
    const trigger = container.querySelector('[role="combobox"]') as HTMLElement

    await act(async () => trigger.click())
    expect(isSelectOpen()).toBe(true)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect([...document.querySelectorAll('[role="option"]')].map(node => node.textContent))
      .toEqual(['本地目录', 'Git 仓库', 'MirrorChyan'])

    await act(async () => optionByLabel('MirrorChyan')?.click())
    await act(async () => {})
    expect(picked).toEqual(['mirrorchyan'])
    expect(trigger.textContent).toContain('MirrorChyan')
    expect(isSelectOpen()).toBe(false)
  })

  it('navigates the popup with the keyboard and highlights items', async () => {
    const picked: string[] = []
    await act(async () => root.render(<Host onValue={value => picked.push(value)} />))
    const trigger = container.querySelector('[role="combobox"]') as HTMLElement
    const pressKey = (key: string) => {
      trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    }

    await act(async () => {
      trigger.focus()
      pressKey('ArrowDown')
    })
    expect(document.querySelector('[role="listbox"]')).toBeTruthy()
    expect(document.querySelector('[role="option"][aria-selected="true"]')?.textContent).toBe('Git 仓库')

    await act(async () => pressKey('ArrowDown'))
    const highlighted = document.querySelector('[role="option"][data-highlighted]')
    expect(highlighted?.textContent).toBe('MirrorChyan')

    await act(async () => optionByLabel('MirrorChyan')?.click())
    await act(async () => {})
    expect(picked).toEqual(['mirrorchyan'])

    await act(async () => pressKey('ArrowDown'))
    expect(isSelectOpen()).toBe(true)
    await act(async () => pressKey('Escape'))
    expect(isSelectOpen()).toBe(false)
    expect(picked).toEqual(['mirrorchyan'])
  })

  it('jumps the highlight via typeahead when typing item labels', async () => {
    await act(async () => root.render(<Host onValue={() => undefined} />))
    const trigger = container.querySelector('[role="combobox"]') as HTMLElement
    await act(async () => trigger.click())
    await act(async () => {
      trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: '本', bubbles: true, cancelable: true }))
    })
    const highlighted = document.querySelector('[role="option"][data-highlighted]')
    expect(highlighted?.textContent).toBe('本地目录')
  })

  it('keeps the trigger disabled for interaction', async () => {
    function DisabledHost() {
      return (
        <Select items={SOURCES} value="local" onValueChange={() => undefined} disabled>
          <SelectTrigger aria-label="资源来源">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SOURCES.map(item => (
              <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }
    await act(async () => root.render(<DisabledHost />))
    const trigger = container.querySelector('[role="combobox"]') as HTMLButtonElement
    expect(trigger.disabled).toBe(true)
    await act(async () => trigger.click())
    expect(isSelectOpen()).toBe(false)
  })
})
