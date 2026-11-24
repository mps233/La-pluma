'use client'

// GlassDropdownMenu — a menu of actions that is one body of liquid glass with the control that
// opens it: the list swells out of the control, holds on by a neck that thins and snaps, and
// closes by the same motion played backwards (GlassPopup, `glass-popup.tsx`).
//
//   <GlassDropdownMenu>
//     <GlassDropdownMenuTrigger>Options</GlassDropdownMenuTrigger>
//     <GlassDropdownMenuContent>
//       <GlassDropdownMenuItem onSelect={rename}>Rename</GlassDropdownMenuItem>
//       <GlassDropdownMenuSeparator />
//       <GlassDropdownMenuItem destructive onSelect={remove}>Delete</GlassDropdownMenuItem>
//     </GlassDropdownMenuContent>
//   </GlassDropdownMenu>
//
// Out of a button group: wrap the group and the content, and put the trigger on one of its
// items with `asChild`. The whole group is then the anchor, and the list takes its colour.
//
//   <GlassDropdownMenu>
//     <GlassButtonGroup>
//       <GlassButtonGroupItem>Snooze</GlassButtonGroupItem>
//       <GlassDropdownMenuTrigger asChild>
//         <GlassButtonGroupItem aria-label="More"><Ellipsis /></GlassButtonGroupItem>
//       </GlassDropdownMenuTrigger>
//     </GlassButtonGroup>
//     <GlassDropdownMenuContent>…</GlassDropdownMenuContent>
//   </GlassDropdownMenu>
//
// UI SDK owns the behaviour (keyboard, typeahead, focus, the top layer, positioning, ARIA); the
// kit's engine owns the material. Needs @ui-sdk/core and @ui-sdk/react.
// Without WebGL2 it is a plain frosted list.

import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, type MenuProps } from '@ui-sdk/react/menu'
import { Children, cloneElement, createContext, isValidElement, useContext, type CSSProperties, type ComponentProps, type ReactElement, type ReactNode } from 'react'

import { GlassPopupAnchor, GlassPopupContext, GlassPopupSurface, OVER_CENTER, OVER_EDGE, spellLabel, useGlassPopup } from './glass-popup'

export type GlassDropdownMenuProps = MenuProps & {
  /**
   * The control itself unfolds into the menu (Popover's opening). `center`: the menu lies around
   * it. `edge`: from the control's own edge, growing away from it. Left out, the list swells out
   * of the control on a neck.
   */
  over?: 'center' | 'edge'
  /**
   * With `over`: which way the menu comes into place. `top` (default): the control is thrown down
   * and the menu comes down from above. `bottom`: the other way up.
   */
  from?: 'top' | 'bottom'
}

/** Where this menu lies over its control, if it does. */
const OverContext = createContext<'center' | 'edge' | undefined>(undefined)

export type GlassDropdownMenuTriggerProps = {
  children?: ReactNode
  /** Put the trigger on the single child element (a GlassButtonGroupItem) instead of a glass button of its own. */
  asChild?: boolean
  className?: string
} & Omit<ComponentProps<typeof MenuTrigger>, 'children' | 'className' | 'render'>

export type GlassDropdownMenuContentProps = { children?: ReactNode; className?: string } & Omit<ComponentProps<typeof MenuContent>, 'children' | 'className' | 'render'>

export type GlassDropdownMenuItemProps = { className?: string } & Omit<ComponentProps<typeof MenuItem>, 'className' | 'render'>

export function GlassDropdownMenu({ children, over, from = 'top', ...options }: GlassDropdownMenuProps) {
  const popup = useGlassPopup({ opening: over ? 'morph' : 'stretch', from })
  return (
    <Menu {...options}>
      <OverContext.Provider value={over}>
        <GlassPopupContext.Provider value={popup}>{children}</GlassPopupContext.Provider>
      </OverContext.Provider>
    </Menu>
  )
}

/** The control that opens the menu: a glass button of its own, or with `asChild` your own element inside a GlassButtonGroup. */
export function GlassDropdownMenuTrigger({ children, asChild = false, className = '', ...rest }: GlassDropdownMenuTriggerProps) {
  const popup = useContext(GlassPopupContext)
  const over = useContext(OverContext)
  if (asChild || !popup) return <MenuTrigger render={Children.only(children) as ReactElement} {...rest} />
  return (
    <MenuTrigger
      data-glass-host=""
      className={`inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full border border-black/10 bg-white/60 px-5 text-sm font-semibold whitespace-nowrap text-neutral-900 outline-none select-none focus-visible:ring-2 focus-visible:ring-[#3291FF] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:bg-white/10 dark:text-white data-[glass-tone=dark]:text-white data-[glass-tone=light]:text-neutral-900 [&_svg]:size-4 [&_svg]:shrink-0 ${className}`}
      {...rest}
    >
      <GlassPopupAnchor popup={popup} />
      {/* One element, so the label sways with the glass when the neck pulls and snaps. With `over` the label leaves, and its text comes back letter by letter. */}
      <span className="inline-flex items-center gap-[inherit]">{over ? spellLabel(children) : children}</span>
    </MenuTrigger>
  )
}

/** The list, centred on its control unless `align` says otherwise. Its children are items and separators; they arrive one after another (with `over`, together). */
export function GlassDropdownMenuContent({ children, className = '', sideOffset, align = 'center', ...rest }: GlassDropdownMenuContentProps) {
  const popup = useContext(GlassPopupContext)
  const over = useContext(OverContext)
  const centered = over === 'center'
  return (
    <MenuContent
      data-glass-popup=""
      data-glass-skip=""
      sideOffset={sideOffset ?? (over ? 0 : 12)}
      align={align}
      className={`group/glass min-w-44 rounded-3xl p-1.5 text-[15px] text-neutral-900 outline-none data-[glass-tone=dark]:text-white data-[glass-tone=light]:text-neutral-900 ${over && sideOffset === undefined ? (centered ? OVER_CENTER : OVER_EDGE) : ''} ${className}`}
      {...rest}
      {...(centered ? { side: 'bottom' as const } : null)}
    >
      {popup && <GlassPopupSurface popup={popup} />}
      <div data-glass-list="" className="flex flex-col">
        {/* Each child's place in the queue. */}
        {Children.toArray(children).map((child, i) =>
          isValidElement<{ style?: CSSProperties }>(child) ? cloneElement(child, { style: { '--glass-i': i, ...child.props.style } as CSSProperties }) : child,
        )}
      </div>
    </MenuContent>
  )
}

/** An action. Pressing it runs `onSelect` and closes the menu. `destructive` paints it red. */
export function GlassDropdownMenuItem({ className = '', ...rest }: GlassDropdownMenuItemProps) {
  return (
    <MenuItem
      className={`relative flex h-10 cursor-pointer items-center gap-2.5 rounded-2xl px-3.5 font-medium whitespace-nowrap outline-none select-none transition-colors duration-100 data-[disabled]:cursor-not-allowed data-[highlighted]:bg-current/10 data-[destructive]:text-red-600 group-data-[glass-tone=dark]/glass:data-[destructive]:text-red-400 [&_svg]:size-4 [&_svg]:shrink-0 ${className}`}
      {...rest}
    />
  )
}

/** A hairline between items. */
export function GlassDropdownMenuSeparator({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <MenuSeparator data-glass-item="" style={style} className={`mx-3.5 my-1 h-px shrink-0 bg-current/15 ${className}`} />
}

export default GlassDropdownMenu
