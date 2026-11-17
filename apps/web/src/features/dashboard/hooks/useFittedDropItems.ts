import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { fitDropItems } from '../model/dropItemFit'

interface FittedDropItemsState {
  readonly visible: readonly string[]
  readonly truncated: boolean
}

export function useFittedDropItems(text: string) {
  const items = useMemo(() => text.split('、').filter(Boolean), [text])
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [fit, setFit] = useState<FittedDropItemsState>({ visible: items, truncated: false })

  useLayoutEffect(() => {
    const container = containerRef.current
    const showAll = () => setFit({ visible: items, truncated: false })

    if (!container || typeof ResizeObserver === 'undefined' || typeof document === 'undefined') {
      showAll()
      return
    }

    const context = document.createElement('canvas').getContext('2d')
    if (!context) {
      showAll()
      return
    }

    const measure = (value: string) => context.measureText(value).width
    const update = () => {
      const width = container.clientWidth
      if (width <= 0) {
        showAll()
        return
      }
      const style = window.getComputedStyle(container)
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      setFit(fitDropItems(items, width - 2, measure))
    }

    const observer = new ResizeObserver(update)
    observer.observe(container)
    update()
    return () => observer.disconnect()
  }, [items])

  return { containerRef, ...fit }
}
