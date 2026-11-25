// @vitest-environment jsdom

import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsSection from '../components/SettingsSection'
import SettingsSectionNav from '../components/SettingsSectionNav'
import { CONFIG_SECTION_EVENT, CONFIG_SECTION_STORAGE_KEY } from '../model/configSection'
import { SETTINGS_SECTION_IDS } from '../model/settingsSections'
import { useSettingsSectionNavigation } from './useSettingsSectionNavigation'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Harness() {
  const contentRef = useRef<HTMLDivElement>(null)
  const { activeSection, selectSection } = useSettingsSectionNavigation(contentRef)

  return (
    <div data-region="scroll">
      <div ref={contentRef}>
        {SETTINGS_SECTION_IDS.map(id => (
          <SettingsSection key={id} id={id}>
            <div>{id}</div>
          </SettingsSection>
        ))}
      </div>
      <SettingsSectionNav activeSection={activeSection} onSelect={selectSection} />
    </div>
  )
}

let container: HTMLDivElement
let root: Root
let host: HTMLElement
let scrollTop: number

const rect = (top: number) => ({
  top,
  right: 0,
  bottom: top,
  left: 0,
  width: 0,
  height: 0,
  x: 0,
  y: top,
  toJSON: () => ({}),
}) as DOMRect

const nextFrame = async () => {
  await act(async () => {
    await new Promise<void>(resolve => {
      window.requestAnimationFrame(() => resolve())
    })
  })
}

const navLink = (label: string) => (
  Array.from(container.querySelectorAll<HTMLAnchorElement>('[aria-label="本页目录"] a'))
    .find(link => link.textContent?.trim() === label)
)

const scrollTo = async (top: number) => {
  scrollTop = top
  await act(async () => {
    host.dispatchEvent(new Event('scroll'))
  })
  await nextFrame()
}

beforeEach(async () => {
  localStorage.clear()
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => root.render(<Harness />))
  await nextFrame()

  host = container.querySelector<HTMLElement>('[data-region="scroll"]')!
  scrollTop = 0
  Object.defineProperty(host, 'clientHeight', { configurable: true, value: 400 })
  Object.defineProperty(host, 'scrollHeight', { configurable: true, value: 1000 })
  Object.defineProperty(host, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: value => {
      scrollTop = value
    },
  })
  Object.defineProperty(host, 'getBoundingClientRect', {
    configurable: true,
    value: () => rect(0),
  })

  const sections = Array.from(container.querySelectorAll<HTMLElement>('[data-settings-section]'))
  sections.forEach((section, index) => {
    Object.defineProperty(section, 'getBoundingClientRect', {
      configurable: true,
      value: () => rect(index * 120 - scrollTop),
    })
    Object.defineProperty(section, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
  })
  await scrollTo(0)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('useSettingsSectionNavigation', () => {
  it('highlights the section crossing the activation line and the last section at the bottom', async () => {
    expect(navLink('连接')?.getAttribute('aria-current')).toBe('location')

    await scrollTo(250)
    expect(navLink('实例')?.getAttribute('aria-current')).toBe('location')
    expect(Array.from(container.querySelectorAll('[aria-current="location"]'))).toHaveLength(1)

    scrollTop = 600
    await act(async () => {
      host.dispatchEvent(new Event('scroll'))
    })
    await nextFrame()
    expect(navLink('组件更新')?.getAttribute('aria-current')).toBe('location')
  })

  it('scrolls to the selected section and updates the current item', async () => {
    const appearance = container.querySelector<HTMLElement>('[data-settings-section="appearance"]')!
    const scrollIntoView = vi.fn()
    Object.defineProperty(appearance, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })

    await act(async () => navLink('外观')?.click())

    expect(scrollIntoView).toHaveBeenCalledOnce()
    expect(navLink('外观')?.getAttribute('aria-current')).toBe('location')
  })

  it('releases the click lock so later scrolling updates the current item', async () => {
    await act(async () => navLink('外观')?.click())
    expect(navLink('外观')?.getAttribute('aria-current')).toBe('location')

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 750))
    })

    await scrollTo(250)
    expect(navLink('实例')?.getAttribute('aria-current')).toBe('location')
  })

  it('handles the compatibility event and stops listening after unmount', async () => {
    const resource = container.querySelector<HTMLElement>('[data-settings-section="resource"]')!
    const scrollIntoView = vi.fn()
    Object.defineProperty(resource, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })

    await act(async () => {
      window.dispatchEvent(new CustomEvent(CONFIG_SECTION_EVENT, { detail: 'resource' }))
    })

    expect(scrollIntoView).toHaveBeenCalledOnce()
    expect(navLink('资源')?.getAttribute('aria-current')).toBe('location')
    expect(localStorage.getItem(CONFIG_SECTION_STORAGE_KEY)).toBe('resource')

    await act(async () => root.unmount())
    await act(async () => {
      window.dispatchEvent(new CustomEvent(CONFIG_SECTION_EVENT, { detail: 'instance' }))
    })

    expect(localStorage.getItem(CONFIG_SECTION_STORAGE_KEY)).toBe('resource')
    expect(scrollIntoView).toHaveBeenCalledOnce()
    root = createRoot(container)
  })
})
