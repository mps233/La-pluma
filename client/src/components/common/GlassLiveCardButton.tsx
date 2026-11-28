import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react'

import { GlassCard } from '@/components/glass'
import { useCoarsePointer } from '@/hooks/useCoarsePointer'

export interface GlassLiveCardButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  icon?: ReactNode
  href?: string
  target?: string
  rel?: string
  type?: 'button' | 'submit' | 'reset'
}

/**
 * The official pattern for clear glass over moving content: the kit's
 * GlassCard with `live`, holding one interactive control.
 *
 * `live` clear glass repaints every frame while visible. On a touch device
 * that is a constant GPU/CPU cost for a decorative edge, so it falls back to
 * the fixed tinted body (no live repaint, no backdrop snapshot); a mouse
 * desktop keeps the clear, live material.
 */
export const GlassLiveCardButton = forwardRef<HTMLButtonElement, GlassLiveCardButtonProps>(
  function GlassLiveCardButton({ icon, children, className = '', href, target, rel, type = 'button', ...rest }, ref) {
    const coarsePointer = useCoarsePointer()
    const material = coarsePointer ? 'tinted' : 'clear'
    const controlClass = `lg-button inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap select-none outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 ${className}`.trim()
    const content = (
      <>
        {icon ? <span className="lg-button__icon inline-flex shrink-0 items-center justify-center">{icon}</span> : null}
        {children != null && children !== false ? <span className="lg-button__label inline-flex min-w-0 items-center">{children}</span> : null}
      </>
    )
    return (
      <GlassCard
        data-material={material}
        material={material}
        live={!coarsePointer}
        blur={coarsePointer ? 0 : 5}
        className={`lg-host lg-card relative inline-flex rounded-full p-0 ${coarsePointer ? 'bg-[var(--app-surface)]' : ''}`.trim()}
      >
        {href ? (
          <a
            {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}
            href={href}
            target={target}
            rel={rel ?? (target === '_blank' ? 'noopener noreferrer' : undefined)}
            className={controlClass}
          >
            {content}
          </a>
        ) : (
          <button {...rest} ref={ref} type={type} className={controlClass}>
            {content}
          </button>
        )}
      </GlassCard>
    )
  },
)

export default GlassLiveCardButton
