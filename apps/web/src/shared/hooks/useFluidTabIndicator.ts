import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'

interface FluidTabRect {
  x: number
  y: number
  width: number
  height: number
}

const emptyRect: FluidTabRect = { x: 0, y: 0, width: 0, height: 0 }

export function measureFluidTabRect(
  container: HTMLElement,
  activeElement: HTMLElement,
): FluidTabRect {
  const transform = window.getComputedStyle(activeElement).transform
  const containerRect = container.getBoundingClientRect()
  const containerGeometryDistorted = container.offsetWidth > 0
    && (Math.abs(containerRect.width - container.offsetWidth) > 1
      || Math.abs(containerRect.height - container.offsetHeight) > 1)
  if ((!transform || transform === 'none') && !containerGeometryDistorted) {
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

export function useFluidTabIndicator<T extends string>(activeTab: T, layoutKey?: unknown) {
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null)
  const tabRefs = useRef<Partial<Record<T, HTMLElement | null>>>({})
  const [activeRect, setActiveRect] = useState<FluidTabRect>(emptyRect)

  useLayoutEffect(() => {
    const syncActiveRect = () => {
      const activeElement = tabRefs.current[activeTab]
      if (!containerElement || !activeElement) {
        setActiveRect(emptyRect)
        return
      }

      setActiveRect(measureFluidTabRect(containerElement, activeElement))
    }

    syncActiveRect()
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(syncActiveRect)
    if (containerElement) observer?.observe(containerElement)
    const activeElement = tabRefs.current[activeTab]
    if (activeElement) observer?.observe(activeElement)
    window.addEventListener('resize', syncActiveRect)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', syncActiveRect)
    }
  }, [activeTab, containerElement, layoutKey])

  const setContainerRef = useCallback((element: HTMLDivElement | null) => {
    setContainerElement(element)
  }, [])

  const setTabRef = (tab: T) => (element: HTMLElement | null) => {
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

  return { containerRef: setContainerRef, activeRect, setTabRef, handleTabKeyDown }
}
