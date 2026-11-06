import { useEffect, useRef, useState, type HTMLAttributes, type RefObject } from 'react'

// Keep in sync with --app-continuous-radius (1.25rem) in ios-theme.css.
const IOS_CONTINUOUS_RADIUS = 20
const IOS_CONTINUOUS_SMOOTHING = 0.8

type LisseModule = typeof import('@lisse/react')

interface SmoothSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  radius?: number
  smoothing?: number
}

/**
 * The smooth-corner engine is a first-paint dependency for every Card. Load it
 * after mount and keep a plain CSS radius as the fallback, so the entry chunk
 * does not carry the squircle library. The children stay mounted while the
 * engine attaches, which avoids a second mount of page content.
 */
function SmoothCornersEffect({
  lisse,
  targetRef,
  radius,
  smoothing,
}: {
  lisse: LisseModule
  targetRef: RefObject<HTMLDivElement | null>
  radius: number
  smoothing: number
}) {
  lisse.useSmoothCorners(targetRef, { radius, smoothing }, { autoEffects: false })
  return null
}

export default function SmoothSurface({
  children,
  radius = IOS_CONTINUOUS_RADIUS,
  smoothing = IOS_CONTINUOUS_SMOOTHING,
  style,
  ...props
}: SmoothSurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [lisse, setLisse] = useState<LisseModule | null>(null)

  useEffect(() => {
    let cancelled = false
    void import('@lisse/react')
      .then(module => {
        if (!cancelled) setLisse(module)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div
      ref={surfaceRef}
      {...props}
      data-slot="smooth-corners"
      style={lisse ? style : { borderRadius: radius, ...style }}
    >
      {children}
      {lisse && (
        <SmoothCornersEffect
          lisse={lisse}
          targetRef={surfaceRef}
          radius={radius}
          smoothing={smoothing}
        />
      )}
    </div>
  )
}