import { useLayoutEffect, useRef, useState } from 'react'

export interface FluidTabRect {
  x: number
  y: number
  width: number
  height: number
}

const emptyRect: FluidTabRect = { x: 0, y: 0, width: 0, height: 0 }

/** Keeps an animated tab highlight aligned with its active button. */
export function useFluidTabIndicator<T extends string>(activeTab: T) {
  const containerRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({})
  const [activeRect, setActiveRect] = useState<FluidTabRect>(emptyRect)

  useLayoutEffect(() => {
    const syncActiveRect = () => {
      const container = containerRef.current
      const activeElement = tabRefs.current[activeTab]
      if (!container || !activeElement) {
        setActiveRect(emptyRect)
        return
      }

      const containerRect = container.getBoundingClientRect()
      const tabRect = activeElement.getBoundingClientRect()
      setActiveRect({
        x: tabRect.left - containerRect.left,
        y: tabRect.top - containerRect.top,
        width: tabRect.width,
        height: tabRect.height,
      })
    }

    syncActiveRect()
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(syncActiveRect)
    if (containerRef.current) observer?.observe(containerRef.current)
    if (tabRefs.current[activeTab]) observer?.observe(tabRefs.current[activeTab]!)
    window.addEventListener('resize', syncActiveRect)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', syncActiveRect)
    }
  }, [activeTab])

  const setTabRef = (tab: T) => (element: HTMLButtonElement | null) => {
    tabRefs.current[tab] = element
  }

  return { containerRef, activeRect, setTabRef }
}
