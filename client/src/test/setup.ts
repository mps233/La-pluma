import { configure } from '@testing-library/react'

// Vitest 5 starts one worker per file; under a cold 65-worker run, a mocked
// catalog can take longer than Testing Library's 1s default to settle.
configure({ asyncUtilTimeout: 5000 })

// jsdom has no ResizeObserver; the Liquid Glass components observe their
// surfaces on mount. Keep a no-op implementation for every test file.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

// jsdom has no matchMedia; Liquid Glass checks it for haptics on pointer down.
// Existing tests that need a specific result still stub it themselves.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}
