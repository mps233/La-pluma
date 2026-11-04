import type { HTMLAttributes } from 'react'
import SmoothSurface from './SmoothSurface'

// Keep in sync with --app-continuous-radius (20px) and
// --app-continuous-radius-compact (16px) in ios-theme.css.
const PANEL_RADII = {
  panel: 20,
  compact: 16,
} as const

interface SmoothPanelProps extends HTMLAttributes<HTMLDivElement> {
  cornerSize?: keyof typeof PANEL_RADII
  surfaceClassName?: string
}

/**
 * Continuous-corner panel with an unclipped shell for shadows and motion.
 */
export default function SmoothPanel({
  children,
  className = '',
  cornerSize = 'panel',
  surfaceClassName = '',
  ...props
}: SmoothPanelProps) {
  return (
    <div
      {...props}
      className={`smooth-panel-shell smooth-panel-${cornerSize} surface-panel ${className}`}
      data-smooth-corners="true"
    >
      <SmoothSurface
        radius={PANEL_RADII[cornerSize]}
        className={`smooth-panel-surface ${surfaceClassName}`}
      >
        {children}
      </SmoothSurface>
    </div>
  )
}
