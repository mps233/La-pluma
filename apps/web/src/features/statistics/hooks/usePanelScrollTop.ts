import { useCallback, useEffect, useLayoutEffect, useRef, useState, type UIEvent } from 'react'
import { flushSync } from 'react-dom'

export const PANEL_SCROLL_TOP_THRESHOLD_PX = 160

const RETURN_INTERRUPT_EVENTS = ['wheel', 'touchstart', 'pointerdown'] as const
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '])
const SCROLL_HOST_SELECTOR = '[data-region="scroll"]'
const NAVBAR_SELECTOR = '[data-region="navbar"]'
const TABBAR_SELECTOR = '[data-region="tabbar"]'
const CLIP_SELECTOR = '[data-scroll-clip]'
const CLIP_TOLERANCE_PX = 0.5

export interface PanelScrollMetrics {
  progress: number
  viewportRatio: number
  hasOverflow: boolean
}

interface ContentBand {
  top: number
  bottom: number
}

const IDLE_METRICS: PanelScrollMetrics = { progress: 0, viewportRatio: 1, hasOverflow: false }

function readScrollMetrics(node: HTMLDivElement): PanelScrollMetrics {
  const scrollable = node.scrollHeight - node.clientHeight
  if (scrollable <= 0) return IDLE_METRICS
  return {
    progress: Math.min(1, Math.max(0, node.scrollTop / scrollable)),
    viewportRatio: Math.min(1, node.clientHeight / node.scrollHeight),
    hasOverflow: true,
  }
}

function sameMetrics(left: PanelScrollMetrics, right: PanelScrollMetrics) {
  return left.progress === right.progress
    && left.viewportRatio === right.viewportRatio
    && left.hasOverflow === right.hasOverflow
}

function measureContentBand(root: HTMLElement | null): ContentBand {
  const rootRect = root?.getBoundingClientRect() ?? {
    top: 0,
    bottom: window.innerHeight,
  } as DOMRect
  const navbarRect = document.querySelector(NAVBAR_SELECTOR)?.getBoundingClientRect()
  const tabbarRect = document.querySelector(TABBAR_SELECTOR)?.getBoundingClientRect()
  const top = navbarRect ? Math.max(rootRect.top, navbarRect.bottom) : rootRect.top
  const bottom = tabbarRect && tabbarRect.height > 0
    ? Math.min(rootRect.bottom, tabbarRect.top)
    : rootRect.bottom
  return { top, bottom }
}

function isAnchorFullyVisible(anchor: HTMLElement) {
  const rect = anchor.getBoundingClientRect()
  if (rect.height <= 0) return true

  const clip = anchor.closest<HTMLElement>(CLIP_SELECTOR)
  if (clip) {
    const clipRect = clip.getBoundingClientRect()
    if (clipRect.height > 0
      && (clipRect.top > rect.top + CLIP_TOLERANCE_PX
        || clipRect.bottom < rect.bottom - CLIP_TOLERANCE_PX)) {
      return false
    }
  }

  const band = measureContentBand(anchor.closest<HTMLElement>(SCROLL_HOST_SELECTOR))
  return rect.top >= band.top - CLIP_TOLERANCE_PX && rect.bottom <= band.bottom + CLIP_TOLERANCE_PX
}

export function usePanelScrollTop(reduceMotion: boolean | null | undefined) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const previousTopRef = useRef(0)
  const returningRef = useRef(false)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const gateRef = useRef(false)
  const [scrollNode, setScrollNodeState] = useState<HTMLDivElement | null>(null)
  const [contentBandNode, setContentBandNodeState] = useState<HTMLDivElement | null>(null)
  const [isScrolled, setIsScrolled] = useState(false)
  const [isInContentBand, setIsInContentBand] = useState(false)
  const [scrollMetrics, setScrollMetrics] = useState<PanelScrollMetrics>(IDLE_METRICS)

  const setScrollNode = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node
    returningRef.current = false
    previousTopRef.current = node?.scrollTop ?? 0
    setScrollNodeState(node)
    setScrollMetrics(node ? readScrollMetrics(node) : IDLE_METRICS)
    setIsScrolled(node !== null && node.scrollTop > PANEL_SCROLL_TOP_THRESHOLD_PX)
  }, [])

  const setContentBandNode = useCallback((node: HTMLDivElement | null) => {
    anchorRef.current = node
    setContentBandNodeState(node)
  }, [])

  const commitGate = useCallback((flush: boolean) => {
    const anchor = anchorRef.current
    if (!anchor) return
    const next = isAnchorFullyVisible(anchor)
    if (gateRef.current === next) return
    gateRef.current = next
    if (!flush) {
      setIsInContentBand(next)
      return
    }
    flushSync(() => setIsInContentBand(next))
  }, [])

  useLayoutEffect(() => {
    commitGate(false)
  })

  useEffect(() => {
    if (!contentBandNode) return undefined

    const host = contentBandNode.closest<HTMLElement>(SCROLL_HOST_SELECTOR)
    const clip = contentBandNode.closest<HTMLElement>(CLIP_SELECTOR)
    const onScroll = () => commitGate(true)
    const onLayoutChange = () => commitGate(false)

    host?.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onLayoutChange)
    window.addEventListener('orientationchange', onLayoutChange)
    window.visualViewport?.addEventListener('resize', onLayoutChange)

    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(onLayoutChange) : null
    if (resizeObserver) {
      if (host) resizeObserver.observe(host)
      if (clip) resizeObserver.observe(clip)
      const anchorParent = contentBandNode.parentElement
      if (anchorParent) resizeObserver.observe(anchorParent)
      for (const selector of [NAVBAR_SELECTOR, TABBAR_SELECTOR]) {
        const node = document.querySelector(selector)
        if (node) resizeObserver.observe(node)
      }
    }

    return () => {
      host?.removeEventListener('scroll', onScroll)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onLayoutChange)
      window.removeEventListener('orientationchange', onLayoutChange)
      window.visualViewport?.removeEventListener('resize', onLayoutChange)
      resizeObserver?.disconnect()
    }
  }, [contentBandNode, commitGate])

  useEffect(() => {
    if (!scrollNode) return undefined

    const syncMetrics = () => {
      const next = readScrollMetrics(scrollNode)
      setScrollMetrics(current => (sameMetrics(current, next) ? current : next))
    }
    const mutationObserver = typeof MutationObserver === 'function'
      ? new MutationObserver(syncMetrics)
      : null
    mutationObserver?.observe(scrollNode, { childList: true, subtree: true })

    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', syncMetrics)
      return () => {
        mutationObserver?.disconnect()
        window.removeEventListener('resize', syncMetrics)
      }
    }

    const resizeObserver = new ResizeObserver(syncMetrics)
    resizeObserver.observe(scrollNode)
    return () => {
      mutationObserver?.disconnect()
      resizeObserver.disconnect()
    }
  }, [scrollNode])

  useEffect(() => {
    if (!scrollNode) return undefined

    const releaseReturn = () => {
      if (!returningRef.current) return
      returningRef.current = false
      previousTopRef.current = scrollNode.scrollTop
      setIsScrolled(scrollNode.scrollTop > PANEL_SCROLL_TOP_THRESHOLD_PX)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) releaseReturn()
    }

    for (const eventName of RETURN_INTERRUPT_EVENTS) {
      scrollNode.addEventListener(eventName, releaseReturn, { passive: true })
    }
    scrollNode.addEventListener('keydown', handleKeyDown)
    scrollNode.addEventListener('scrollend', releaseReturn)

    return () => {
      for (const eventName of RETURN_INTERRUPT_EVENTS) {
        scrollNode.removeEventListener(eventName, releaseReturn)
      }
      scrollNode.removeEventListener('keydown', handleKeyDown)
      scrollNode.removeEventListener('scrollend', releaseReturn)
    }
  }, [scrollNode])

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget
    const top = node.scrollTop
    const previous = previousTopRef.current
    previousTopRef.current = top

    setScrollMetrics(current => {
      const next = readScrollMetrics(node)
      return sameMetrics(current, next) ? current : next
    })

    if (returningRef.current) {
      if (top <= 0) {
        returningRef.current = false
        setIsScrolled(false)
        commitGate(false)
        return
      }
      if (top <= previous) {
        setIsScrolled(false)
        commitGate(false)
        return
      }
      returningRef.current = false
    }

    setIsScrolled(top > PANEL_SCROLL_TOP_THRESHOLD_PX)
    commitGate(false)
  }, [commitGate])

  const scrollToTop = useCallback(() => {
    const node = scrollRef.current
    if (!node) return

    node.focus({ preventScroll: true })
    setIsScrolled(false)

    if (reduceMotion || typeof node.scrollTo !== 'function') {
      returningRef.current = false
      previousTopRef.current = 0
      node.scrollTop = 0
      return
    }

    returningRef.current = true
    previousTopRef.current = node.scrollTop
    node.scrollTo({ top: 0, behavior: 'smooth' })
  }, [reduceMotion])

  return {
    setScrollNode,
    setContentBandNode,
    isScrolled,
    isInContentBand,
    scrollMetrics,
    handleScroll,
    scrollToTop,
  }
}
