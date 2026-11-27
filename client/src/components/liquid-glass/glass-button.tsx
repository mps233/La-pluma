'use client'

// GlassButton — a button made of liquid glass. It swells under the pointer and grows when pressed.
// A pointer that holds it and drags away pulls it after itself, stretched like gel (`pull={false}`
// keeps it in its place).
//
//   <GlassButton icon={<ArrowRight />}>Get started</GlassButton>                     // clear glass
//   <GlassButton material="tinted" className="bg-blue-500 text-white">Save</GlassButton>
//   <GlassButton asChild><Link href="/docs">Read the docs</Link></GlassButton>       // any element
//
// Clear glass bends the page behind it. Tinted glass takes its colour from the button's
// own CSS background, so you colour it with a normal class. With `asChild` the glass goes
// on your own element (a router link, an <a>) instead of a <button>.
//
// The button itself is UI SDK's: return a Promise from `onClick` and it stays pending
// (no second press, announced to screen readers) until it settles. Needs @ui-sdk/core
// and @ui-sdk/react. COPY VERBATIM. MIT.

import { Button } from '@ui-sdk/react/button'
import { Children, cloneElement, type ComponentProps, type ReactElement, type ReactNode } from 'react'

import { GlassLayer, type GlassMaterial } from './glass-layer'

export type GlassButtonSize = 'sm' | 'md' | 'lg' | 'xl'

export type GlassButtonProps = {
  children?: ReactNode
  /** Glass look. Default `clear`. */
  material?: GlassMaterial
  size?: GlassButtonSize
  /** An icon element (e.g. a lucide-react icon). */
  icon?: ReactNode
  iconPosition?: 'start' | 'end'
  /** Clear glass: how much tint covers the backdrop (0–1). */
  tint?: number
  /** Hold and drag: the button follows the pointer a little way, stretches along the pull and swings back when let go. Default `true`. */
  pull?: boolean
  /** Render the glass on the single child element (e.g. a router `<Link>`) instead of a `<button>`. */
  asChild?: boolean
  className?: string
} & Omit<ComponentProps<typeof Button>, 'children' | 'className' | 'render'>

const sizes: Record<GlassButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-4 text-[13px] [&_svg]:size-3.5',
  md: 'h-10 gap-2 px-5 text-sm [&_svg]:size-4',
  lg: 'h-12 gap-2 px-6 text-[15px] [&_svg]:size-[18px]',
  xl: 'h-16 gap-2.5 px-8 text-lg [&_svg]:size-5',
}

// The look before the glass draws (first paint, and the permanent look without WebGL2).
const fallback: Record<GlassMaterial, string> = {
  // Text follows the glass's own tone once it draws, so it reads on any backdrop.
  clear:
    'border border-black/10 bg-white/60 text-neutral-900 shadow-sm backdrop-blur-md dark:border-white/15 dark:bg-white/10 dark:text-white data-[glass-tone=dark]:text-white data-[glass-tone=light]:text-neutral-900',
  tinted: '',
}

export function GlassButton({
  children,
  material = 'clear',
  size = 'md',
  icon,
  iconPosition = 'end',
  tint,
  pull = true,
  asChild = false,
  className = '',
  type = 'button',
  ...rest
}: GlassButtonProps) {
  // A pill unless you bring your own corners: any `rounded-*` class replaces `rounded-full`
  // (the stylesheet's order, not the class order, would otherwise decide which one wins).
  const own = asChild ? `${(Children.only(children) as ReactElement<{ className?: string }>).props.className ?? ''} ${className}` : className
  const corners = /(^|\s)!?rounded-/.test(own) ? '' : 'rounded-full'
  const classes = `inline-flex shrink-0 cursor-pointer items-center justify-center ${corners} font-semibold whitespace-nowrap select-none outline-none focus-visible:ring-2 focus-visible:ring-[#3291FF] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:opacity-40 [&_svg]:shrink-0 ${sizes[size]} ${fallback[material]}`
  // The glass layer must be the host's first child.
  const content = (label: ReactNode) => (
    <>
      <GlassLayer material={material} tint={tint} pull={pull} />
      {icon && iconPosition === 'start' && icon}
      {label}
      {icon && iconPosition === 'end' && icon}
    </>
  )
  if (asChild) {
    const child = Children.only(children) as ReactElement<{ className?: string; children?: ReactNode }>
    return cloneElement(
      child,
      { ...rest, 'data-glass-host': '', className: `${classes} ${child.props.className ?? ''} ${className}` } as Record<string, unknown>,
      content(child.props.children),
    )
  }
  return (
    <Button data-glass-host="" type={type} className={`${classes} ${className}`} {...rest}>
      {content(children)}
    </Button>
  )
}

export default GlassButton
