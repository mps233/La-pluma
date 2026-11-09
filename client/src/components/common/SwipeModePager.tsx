import { Children, type ReactNode } from 'react'
import type { SwipeModeTrack } from '@/hooks/useSwipeModeTrack'

interface SwipeModePagerProps {
  /** Track state from `useSwipeModeTrack`. */
  track: SwipeModeTrack
  /** Active slide index; must match the track's index. */
  index: number
  /** One child per mode, in the same order as the segmented control. */
  children: ReactNode
  className?: string
  slideClassName?: string
}

/**
 * Horizontal mode track used by page-level segmented controls on touch
 * devices. Inactive slides stay mounted so the next card is visible while the
 * finger drags; they are inert and hidden from assistive technology.
 */
export default function SwipeModePager({
  track,
  index,
  children,
  className = '',
  slideClassName = '',
}: SwipeModePagerProps) {
  const slides = Children.toArray(children)
  const { viewportRef, trackRef, activeSlideRef, viewportStyle } = track

  return (
    <div
      ref={viewportRef}
      className={`swipe-mode-viewport${className ? ` ${className}` : ''}`}
      style={viewportStyle}
    >
      <div ref={trackRef} className="swipe-mode-track">
        {slides.map((slide, slideIndex) => {
          const active = slideIndex === index
          return (
            <section
              key={slideIndex}
              ref={active ? activeSlideRef : undefined}
              className={`swipe-mode-slide${slideClassName ? ` ${slideClassName}` : ''}`}
              aria-hidden={active ? undefined : true}
              inert={active ? undefined : true}
            >
              {slide}
            </section>
          )
        })}
      </div>
    </div>
  )
}