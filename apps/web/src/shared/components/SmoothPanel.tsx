import type { HTMLAttributes } from 'react'
import SmoothSurface from './SmoothSurface'

const PANEL_RADII = {
  panel: 20,
  compact: 16,
} as const

interface SmoothPanelProps extends HTMLAttributes<HTMLDivElement> {
  cornerSize?: keyof typeof PANEL_RADII
  surfaceClassName?: string
}

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
