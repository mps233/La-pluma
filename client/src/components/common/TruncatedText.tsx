import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import Tooltip from './Tooltip'

type TruncatedTextTag = 'span' | 'div' | 'strong' | 'small' | 'p' | 'h3' | 'h4'

export interface TruncatedTextProps extends HTMLAttributes<HTMLElement> {
  as?: TruncatedTextTag
  children: ReactNode
  /** Full text for the tooltip. Defaults to string/number children. */
  tooltip?: ReactNode
  side?: 'top' | 'bottom'
  /** Layout classes for the Tooltip trigger wrapper. */
  triggerClassName?: string
  triggerAs?: 'span' | 'div'
  tooltipClassName?: string
  disabled?: boolean
}

function isBlockTag(tag: TruncatedTextTag) {
  return tag === 'div' || tag === 'p' || tag === 'h3' || tag === 'h4'
}

/**
 * Single-line text that truncates and shows its full value only when it is
 * actually cut. The Tooltip trigger wrapper is always present, so toggling the
 * tooltip never changes layout. The full string stays in the DOM for screen
 * readers; when the caller already renders a complete accessible value, this
 * component does not add a second one.
 */
export default function TruncatedText({
  as = 'span',
  children,
  tooltip,
  side = 'top',
  className = '',
  triggerClassName = 'flex w-full min-w-0',
  triggerAs,
  tooltipClassName,
  disabled = false,
  ...rest
}: TruncatedTextProps) {
  const textRef = useRef<HTMLElement | null>(null)
  const [truncated, setTruncated] = useState(false)
  const tooltipContent = tooltip
    ?? (typeof children === 'string' || typeof children === 'number'
      ? String(children)
      : null)

  const measure = useCallback(() => {
    const node = textRef.current
    if (!node) return
    const next = node.clientWidth > 0 && node.scrollWidth - node.clientWidth > 1
    setTruncated(current => (current === next ? current : next))
  }, [])

  useLayoutEffect(() => {
    const node = textRef.current
    if (!node) return undefined

    // Measure after the commit, not during the effect body, so React does not
    // see a synchronous state update caused only by reading layout.
    queueMicrotask(measure)

    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure)
      observer.observe(node)
    }

    let cancelled = false
    const handleResize = () => measure()
    window.addEventListener('resize', handleResize)

    const fonts = typeof document === 'undefined' ? undefined : document.fonts
    fonts?.ready
      .then(() => {
        if (!cancelled) measure()
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
      observer?.disconnect()
      window.removeEventListener('resize', handleResize)
    }
  }, [measure, children, tooltip])

  const setTextRef = useCallback((node: HTMLElement | null) => {
    textRef.current = node
  }, [])

  const Tag = as
  const label = (
    <Tag
      {...rest}
      ref={setTextRef}
      className={`app-truncate ${className}`.trim()}
      data-truncated={truncated ? 'true' : undefined}
    >
      {children}
    </Tag>
  )

  return (
    <Tooltip
      content={tooltipContent}
      side={side}
      disabled={disabled || !truncated || !tooltipContent}
      triggerAs={triggerAs ?? (isBlockTag(as) ? 'div' : 'span')}
      triggerClassName={`app-truncate-trigger ${triggerClassName}`.trim()}
      className={tooltipClassName}
    >
      {label}
    </Tooltip>
  )
}
