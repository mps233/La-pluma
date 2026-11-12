import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react'
import { createSpring, springFrom, type Spring } from '@zakisheriff/liquid-glass'
import { useSwipePager, type SwipePagerCommit, type SwipePagerHandlers } from './useSwipePager'

const MODE_TRACK_SPRING = springFrom(0.36, 0.86)
const SPRING_SETTLE_TIMEOUT = 900
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export interface UseSwipeModeTrackOptions {
  count: number
  index: number
  /** Receives the committed index after the release animation settles. */
  onChange: (index: number) => void
  /** Appended to the swipe pager's ignore list. */
  extraIgnoreSelector?: string
}

export interface SwipeModeTrack<T extends HTMLElement = HTMLDivElement> {
  handlers: SwipePagerHandlers<T>
  viewportRef: RefObject<HTMLDivElement | null>
  trackRef: RefObject<HTMLDivElement | null>
  activeSlideRef: RefObject<HTMLElement | null>
  viewportStyle: CSSProperties | undefined
  isAnimating: () => boolean
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

/**
 * Finger-following horizontal track for page-level segmented modes.
 * The active slide's height drives the viewport, and a release springs to the
 * adjacent slide before the consumer's index changes. Mirrors the combat
 * workspace track so every mode switcher feels the same on touch devices.
 */
export function useSwipeModeTrack<T extends HTMLElement = HTMLDivElement>({
  count,
  index,
  onChange,
  extraIgnoreSelector,
}: UseSwipeModeTrackOptions): SwipeModeTrack<T> {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const activeSlideRef = useRef<HTMLElement | null>(null)
  const [activeSlideHeight, setActiveSlideHeight] = useState<number | undefined>(undefined)
  const springRef = useRef<Spring | null>(null)
  const trackXRef = useRef(0)
  const animatingRef = useRef(false)
  const initialSnapRef = useRef(true)

  const getStep = (track: HTMLElement) => {
    const gap = Number.parseFloat(window.getComputedStyle(track).columnGap || '0') || 0
    return (track.offsetWidth || window.innerWidth) + gap
  }

  const animateTrack = useCallback((to: number, immediate = false) => new Promise<void>((resolve) => {
    const track = trackRef.current
    if (!track) {
      resolve()
      return
    }

    springRef.current?.stop()
    springRef.current = null

    if (immediate) {
      trackXRef.current = to
      track.style.transition = 'none'
      track.style.transform = `translate3d(${to}px, 0, 0)`
      resolve()
      return
    }

    let settled = false
    let timer = 0
    const finish = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      if (springRef.current === spring) {
        trackXRef.current = to
        track.style.transition = 'none'
        track.style.transform = `translate3d(${to}px, 0, 0)`
        springRef.current.stop()
        springRef.current = null
      }
      resolve()
    }
    const spring = createSpring(trackXRef.current, MODE_TRACK_SPRING, (value, velocity) => {
      trackXRef.current = value
      track.style.transition = 'none'
      track.style.transform = `translate3d(${value}px, 0, 0)`
      if (Math.abs(value - to) < 0.5 && Math.abs(velocity) < 5) finish()
    })
    springRef.current = spring
    timer = window.setTimeout(finish, SPRING_SETTLE_TIMEOUT)
    spring.set(to)
  }), [])

  const handleMove = useCallback((offsetX: number) => {
    if (animatingRef.current) return
    const track = trackRef.current
    if (!track) return

    springRef.current?.stop()
    springRef.current = null

    const width = track.offsetWidth || window.innerWidth
    const step = getStep(track)
    const atStart = index <= 0
    const atEnd = index >= count - 1
    const resisted = ((atStart && offsetX > 0) || (atEnd && offsetX < 0))
      ? offsetX * 0.28
      : offsetX
    const clamped = Math.max(-width, Math.min(width, resisted))
    trackXRef.current = -index * step + clamped
    track.style.transition = 'none'
    track.style.transform = `translate3d(${trackXRef.current}px, 0, 0)`
  }, [count, index])

  const handleRelease = useCallback((commit: SwipePagerCommit | null) => {
    if (animatingRef.current) return
    const track = trackRef.current
    if (!track) return

    const step = getStep(track)
    const rest = -index * step
    if (!commit) {
      if (Math.abs(trackXRef.current - rest) < 0.5) {
        trackXRef.current = rest
        track.style.transition = 'none'
        track.style.transform = `translate3d(${rest}px, 0, 0)`
        return
      }
      animatingRef.current = true
      void animateTrack(rest).then(() => {
        animatingRef.current = false
      })
      return
    }

    const target = -commit.nextIndex * step
    // An unmeasurable track (jsdom, a hidden Activity page) cannot animate;
    // commit immediately so state and tests stay deterministic.
    if (!track.offsetWidth || prefersReducedMotion()) {
      trackXRef.current = target
      track.style.transition = 'none'
      track.style.transform = `translate3d(${target}px, 0, 0)`
      onChange(commit.nextIndex)
      return
    }

    animatingRef.current = true
    void animateTrack(target).then(() => {
      onChange(commit.nextIndex)
      animatingRef.current = false
    })
  }, [animateTrack, index, onChange])

  const handlers = useSwipePager<T>({
    count,
    index,
    onChange,
    onMove: handleMove,
    onRelease: handleRelease,
    extraIgnoreSelector,
  })

  useLayoutEffect(() => {
    const slide = activeSlideRef.current
    if (!slide) return

    const updateHeight = () => {
      setActiveSlideHeight(slide.getBoundingClientRect().height)
    }
    updateHeight()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateHeight)
    observer.observe(slide)
    return () => observer.disconnect()
  }, [index])

  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return
    const step = getStep(track)
    if (!step) return

    const target = -index * step
    const immediate = initialSnapRef.current || prefersReducedMotion() || !track.offsetWidth
    initialSnapRef.current = false
    void animateTrack(target, immediate)

    let observedWidth = track.offsetWidth
    const handleResize = () => {
      const nextTrack = trackRef.current
      if (!nextTrack) return
      const nextWidth = nextTrack.offsetWidth
      if (nextWidth === observedWidth) return
      observedWidth = nextWidth
      const nextStep = getStep(nextTrack)
      if (!nextStep) return
      springRef.current?.stop()
      springRef.current = null
      const nextTarget = -index * nextStep
      trackXRef.current = nextTarget
      nextTrack.style.transition = 'none'
      nextTrack.style.transform = `translate3d(${nextTarget}px, 0, 0)`
    }

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', handleResize)
      return () => window.removeEventListener('resize', handleResize)
    }

    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(track)
    return () => resizeObserver.disconnect()
  }, [index, animateTrack])

  const isAnimating = useCallback(() => animatingRef.current, [])

  return {
    handlers,
    viewportRef,
    trackRef,
    activeSlideRef,
    viewportStyle: activeSlideHeight ? { height: `${activeSlideHeight}px` } : undefined,
    isAnimating,
  }
}