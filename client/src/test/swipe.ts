import { act } from 'react'
import { vi } from 'vitest'

const MOBILE_QUERIES = new Set(['(pointer: coarse)', '(max-width: 639px)'])

/**
 * Makes the swipe pager treat the jsdom viewport as a phone. Page tests call
 * this before rendering when they exercise horizontal swipe navigation.
 */
export function installMobileMatchMedia() {
  window.matchMedia = vi.fn((query: string) => ({
    matches: MOBILE_QUERIES.has(query),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

function touchEvent(type: string, x: number, y: number, target: Element): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  const touch = { clientX: x, clientY: y, identifier: 1, target } as unknown as Touch
  Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [touch] })
  Object.defineProperty(event, 'targetTouches', { value: type === 'touchend' ? [] : [touch] })
  Object.defineProperty(event, 'changedTouches', { value: [touch] })
  return event
}

/** Dispatches one horizontal swipe gesture on the element hosting the pager. */
export async function swipe(element: Element, fromX: number, fromY: number, toX: number, toY: number) {
  await act(async () => {
    element.dispatchEvent(touchEvent('touchstart', fromX, fromY, element))
    element.dispatchEvent(touchEvent('touchend', toX, toY, element))
  })
}