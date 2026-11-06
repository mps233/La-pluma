// jsdom has no ResizeObserver; the Liquid Glass components observe their
// surfaces on mount. Keep a no-op implementation for every test file.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}
