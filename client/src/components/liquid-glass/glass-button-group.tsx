'use client'

// GlassButtonGroup — related actions in one body of liquid glass. The buttons share a single
// lens: point at any of them and the whole body swells, press one and it grows.
//
//   <GlassButtonGroup aria-label="Message">
//     <GlassButtonGroupItem>Archive</GlassButtonGroupItem>
//     <GlassButtonGroupItem>Report</GlassButtonGroupItem>
//     <GlassButtonGroupSeparator />
//     <GlassButtonGroupItem aria-label="More"><Ellipsis /></GlassButtonGroupItem>
//   </GlassButtonGroup>
//
// Nest groups to keep some actions together and some apart: the outer group only spaces them.
//
//   <GlassButtonGroup aria-label="Message">
//     <GlassButtonGroup><GlassButtonGroupItem aria-label="Back"><ArrowLeft /></GlassButtonGroupItem></GlassButtonGroup>
//     <GlassButtonGroup>…Archive, Report…</GlassButtonGroup>
//   </GlassButtonGroup>
//
// The glass is Button's. It is tinted white unless you colour it with a `bg-*` class of your
// own (`className="bg-blue-600 text-white"`); `material="clear"` bends the page behind it
// instead. The items are plain
// buttons with no glass of their own: do not put a GlassButton inside. COPY VERBATIM. MIT.

import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react'

import { GlassLayer, type GlassMaterial } from './glass-layer'
import { GlassPopupAnchor, GlassPopupContext } from './glass-popup'

export type GlassButtonGroupSize = 'sm' | 'md' | 'lg'
export type GlassButtonGroupOrientation = 'horizontal' | 'vertical'

export type GlassButtonGroupProps = {
  children?: ReactNode
  /** Side by side (default) or stacked. */
  orientation?: GlassButtonGroupOrientation
  /** Height of a horizontal group: 32, 40 or 48 px. Its items follow. */
  size?: GlassButtonGroupSize
  /** Glass look. Default `tinted`: white, or the colour of your own `bg-*` class. `clear` bends the page behind it. */
  material?: GlassMaterial
  /** Clear glass: how much tint covers the backdrop (0–1). */
  tint?: number
  className?: string
} & Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className'>

export type GlassButtonGroupItemProps = {
  children?: ReactNode
  /** Render the item on the single child element (a router `<Link>`, a menu trigger) instead of a `<button>`. */
  asChild?: boolean
  className?: string
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'>

type Group = { size: GlassButtonGroupSize; vertical: boolean }

const GroupContext = createContext<Group>({ size: 'md', vertical: false })

// The body: its padding, and its corners when stacked (an item's half height plus the padding,
// so the items sit concentric in the corners). Side by side it is a pill.
const bodies: Record<GlassButtonGroupSize, { pad: string; stacked: string }> = {
  sm: { pad: 'p-0.5', stacked: 'rounded-[16px]' },
  md: { pad: 'p-1', stacked: 'rounded-[20px]' },
  lg: { pad: 'p-1', stacked: 'rounded-[24px]' },
}

const items: Record<GlassButtonGroupSize, string> = {
  sm: 'h-7 min-w-7 gap-1.5 px-3 text-[13px] [&_svg]:size-3.5',
  md: 'h-8 min-w-8 gap-2 px-3.5 text-sm [&_svg]:size-4',
  lg: 'h-10 min-w-10 gap-2 px-4.5 text-[15px] [&_svg]:size-[18px]',
}

// The glass sizes its shadow by its height. A stack is several items tall: bring the shadow
// back to about one item's.
const STACKED = { shadowOffset: 0.35, shadowSoftness: 0.35 }

// Tinted glass with no `bg-*` class of your own is white, in light and dark.
const WHITE = 'bg-white text-neutral-900'

// The look before the glass draws (first paint, and the permanent look without WebGL2).
const fallback: Record<GlassMaterial, string> = {
  // Text follows the glass's own tone once it draws, so it reads on any backdrop.
  clear:
    'border border-black/10 bg-white/60 text-neutral-900 shadow-sm backdrop-blur-md dark:border-white/15 dark:bg-white/10 dark:text-white data-[glass-tone=dark]:text-white data-[glass-tone=light]:text-neutral-900',
  tinted: '',
}

export function GlassButtonGroup({
  children,
  orientation = 'horizontal',
  size = 'md',
  material = 'tinted',
  tint,
  className = '',
  ...rest
}: GlassButtonGroupProps) {
  const vertical = orientation === 'vertical'
  // Under a GlassDropdownMenu the group is the menu's anchor: the list swells out of its body.
  const popup = useContext(GlassPopupContext)
  // A group of groups is only a row (or a stack) with space between them: each inner group
  // is its own body of glass, so some actions sit together and some apart.
  if (Children.toArray(children).some((child) => isValidElement(child) && child.type === GlassButtonGroup)) {
    return (
      <div role="group" data-orientation={orientation} className={`inline-flex shrink-0 gap-2 ${vertical ? 'flex-col items-stretch' : 'items-center'} ${className}`} {...rest}>
        {children}
      </div>
    )
  }
  const white = material === 'tinted' && !/(^|\s)!?bg-/.test(className) ? WHITE : ''
  // Any `rounded-*` class of your own replaces the group's corners.
  const corners = /(^|\s)!?rounded-/.test(className) ? '' : vertical ? bodies[size].stacked : 'rounded-full'
  return (
    <div
      role="group"
      data-glass-host=""
      data-orientation={orientation}
      data-glass-fill={popup && material === 'tinted' ? '' : undefined}
      className={`inline-flex shrink-0 ${vertical ? 'flex-col items-stretch' : 'items-center'} ${corners} ${bodies[size].pad} font-semibold whitespace-nowrap select-none ${fallback[material]} ${white} ${className}`}
      {...rest}
    >
      {/* The glass layer must be the host's first child. */}
      {popup ? <GlassPopupAnchor popup={popup} /> : <GlassLayer material={material} tint={tint} optics={vertical ? STACKED : undefined} />}
      <GroupContext.Provider value={{ size, vertical }}>{children}</GroupContext.Provider>
    </div>
  )
}

/** One action of the group: a plain button that lies in the group's glass. */
export function GlassButtonGroupItem({ children, asChild = false, className = '', type = 'button', ...rest }: GlassButtonGroupItemProps) {
  const { size } = useContext(GroupContext)
  // No fill of its own, under the pointer either: the glass answers for the whole group.
  const classes = `inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full ${items[size]} outline-none focus-visible:ring-2 focus-visible:ring-[#3291FF] disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40 [&_svg]:shrink-0`
  if (asChild) {
    const child = Children.only(children) as ReactElement<{ className?: string }>
    return cloneElement(child, { ...rest, className: `${classes} ${child.props.className ?? ''} ${className}` } as Record<string, unknown>)
  }
  return (
    <button type={type} className={`${classes} ${className}`} {...rest}>
      {children}
    </button>
  )
}

/** A hairline between two items. It turns with the group. */
export function GlassButtonGroupSeparator({ className = '' }: { className?: string }) {
  const { vertical } = useContext(GroupContext)
  return (
    <span
      role="separator"
      aria-orientation={vertical ? 'horizontal' : 'vertical'}
      className={`shrink-0 bg-current opacity-20 ${vertical ? 'mx-2.5 my-0.5 h-px' : 'mx-0.5 h-1/2 w-px'} ${className}`}
    />
  )
}

/** Text that is not a button: a unit, a count, a label for the items next to it. */
export function GlassButtonGroupText({ children, className = '', ...rest }: { children?: ReactNode; className?: string } & Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'className'>) {
  const { size } = useContext(GroupContext)
  return (
    <span className={`inline-flex shrink-0 items-center justify-center ${items[size]} font-medium opacity-70 ${className}`} {...rest}>
      {children}
    </span>
  )
}

export default GlassButtonGroup
