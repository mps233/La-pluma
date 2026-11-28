'use client'

import { useCallback, useEffect, useRef } from 'react'

import type { GlassViewHandle, GlassViewSpec, GlassViewStats } from './runtime'

// Local performance patch: the renderer is only imported when the user first
// interacts with any glass control. The app adapter paints a solid fallback
// until then. Once the shared runtime is available, every mounted control
// upgrades so a page never mixes glass and fallback after the first touch.
const RUNTIME_READY_EVENT = 'la-pluma:glass-runtime-ready'

/**
 * Registers a canvas with the shared glass renderer. The spec is read fresh every
 * frame, so callers keep animation state in refs and simply return a new spec.
 */
export function useGlassCanvas(spec: GlassViewSpec) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const specRef = useRef(spec)
  specRef.current = spec
  const handle = useRef<GlassViewHandle | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const target: HTMLCanvasElement = canvas
    const control = (target.closest('button, [role="switch"], [role="checkbox"], [role="slider"]')
      ?? target.parentElement) as HTMLElement | null
    let disposed = false
    let loading = false

    function removeTriggers() {
      control?.removeEventListener('pointerdown', load)
      control?.removeEventListener('focusin', load)
      control?.removeEventListener('keydown', load)
      window.removeEventListener(RUNTIME_READY_EVENT, load)
    }

    function load() {
      if (disposed || loading) return
      loading = true
      removeTriggers()
      import('./runtime')
        .then(({ getGlassRuntime }) => getGlassRuntime())
        .then((runtime) => {
          window.dispatchEvent(new Event(RUNTIME_READY_EVENT))
          return runtime.createView(target, () => specRef.current)
        })
        .then((view) => {
          if (disposed) {
            view.dispose()
            return
          }
          handle.current = view
          target.dataset.glassReady = 'true'
        })
        .catch((error) => console.warn('Liquid glass renderer unavailable', error))
    }

    control?.addEventListener('pointerdown', load, { passive: true })
    control?.addEventListener('focusin', load)
    control?.addEventListener('keydown', load)
    window.addEventListener(RUNTIME_READY_EVENT, load)

    return () => {
      disposed = true
      removeTriggers()
      handle.current?.dispose()
      handle.current = null
      delete target.dataset.glassReady
    }
  }, [])

  // Any React render (new props, theme, size) repaints once.
  useEffect(() => {
    handle.current?.invalidate()
  })

  const invalidate = useCallback(() => handle.current?.invalidate(), [])
  /** Running totals of GPU passes for this canvas (zero until the renderer is up). */
  const stats = useCallback((): GlassViewStats => handle.current?.stats() ?? { renders: 0, ms: 0 }, [])
  return { canvasRef, invalidate, stats }
}
