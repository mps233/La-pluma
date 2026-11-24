import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react'

import { GlassCard } from '@/components/liquid-glass'

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
 */
export const GlassLiveCardButton = forwardRef<HTMLButtonElement, GlassLiveCardButtonProps>(
  function GlassLiveCardButton({ icon, children, className = '', href, target, rel, type = 'button', ...rest }, ref) {
    const controlClass = `lg-button inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap select-none outline-none focus-visible:ring-2 focus-visible:ring-[#3291FF] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 ${className}`.trim()
    const content = (
      <>
        {icon ? <span className="lg-button__icon inline-flex shrink-0 items-center justify-center">{icon}</span> : null}
        {children != null && children !== false ? <span className="lg-button__label inline-flex min-w-0 items-center">{children}</span> : null}
      </>
    )
    return (
      <GlassCard material="clear" live blur={5} className="lg-host lg-card relative inline-flex rounded-full p-0">
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
