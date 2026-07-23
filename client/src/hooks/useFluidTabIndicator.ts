import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'

export interface FluidTabRect {
  x: number
  y: number
  width: number
  height: number
}

const emptyRect: FluidTabRect = { x: 0, y: 0, width: 0, height: 0 }

export function measureFluidTabRect(
  container: HTMLDivElement,
  activeElement: HTMLButtonElement,
): FluidTabRect {
  const transform = window.getComputedStyle(activeElement).transform
  if (!transform || transform === 'none') {
    const containerRect = container.getBoundingClientRect()
    const tabRect = activeElement.getBoundingClientRect()
    return {
      x: tabRect.left - containerRect.left,
      y: tabRect.top - containerRect.top,
      width: tabRect.width,
      height: tabRect.height,
    }
  }

  return {
    x: activeElement.offsetLeft,
    y: activeElement.offsetTop,
    width: activeElement.offsetWidth,
    height: activeElement.offsetHeight,
  }
}

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

      setActiveRect(measureFluidTabRect(container, activeElement))
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

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    tabs: readonly T[],
    onTabChange: (tab: T) => void,
  ) => {
    if (tabs.length === 0) return

    const currentIndex = Math.max(0, tabs.indexOf(activeTab))
    let nextIndex: number | null = null

    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % tabs.length
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1
    }

    const nextTab = nextIndex === null ? undefined : tabs[nextIndex]
    if (!nextTab) return

    event.preventDefault()
    onTabChange(nextTab)
    tabRefs.current[nextTab]?.focus({ preventScroll: true })
  }

  return { containerRef, activeRect, setTabRef, handleTabKeyDown }
}
