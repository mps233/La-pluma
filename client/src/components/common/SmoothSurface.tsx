import { useSmoothCorners } from '@lisse/react'
import { useMemo, useRef, type HTMLAttributes } from 'react'

const IOS_CONTINUOUS_RADIUS = 20
const IOS_CONTINUOUS_SMOOTHING = 0.8

export interface SmoothSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  radius?: number
  smoothing?: number
}

/**
 * Opt-in iOS-style continuous-corner surface.
 * Keep outer shadows on a separate shell because clip-path clips them.
 */
export default function SmoothSurface({
  children,
  radius = IOS_CONTINUOUS_RADIUS,
  smoothing = IOS_CONTINUOUS_SMOOTHING,
  ...props
}: SmoothSurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const corners = useMemo(() => ({ radius, smoothing }), [radius, smoothing])
  useSmoothCorners(surfaceRef, corners, { autoEffects: false })

  return (
    <div ref={surfaceRef} {...props}>
      {children}
    </div>
  )
}
