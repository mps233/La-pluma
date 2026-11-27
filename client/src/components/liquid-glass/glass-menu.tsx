'use client'

// GlassMenu — a menu its button grows into. The button's glass is the menu: pressed, its outline
// pours towards where the menu lies (below, above or beside it), the label goes, and the items
// show as the glass opens over them. Closing runs the same path back, and a close turned round
// half way carries on from where it is (GlassPopup with `opening: 'grow'`, `glass-popup.tsx`).
//
//   <GlassMenu>
//     <GlassMenuTrigger aria-label="More" className="w-12 px-0"><Ellipsis /></GlassMenuTrigger>
//     <GlassMenuContent align="end">
//       <GlassMenuItem onSelect={save}>Save to library</GlassMenuItem>
//       <GlassMenuCheckboxItem value="pinned" checked={pinned} onCheckedChange={setPinned}>Pinned</GlassMenuCheckboxItem>
//       <GlassMenuSeparator />
//       <GlassMenuSub>
//         <GlassMenuSubTrigger>Move to</GlassMenuSubTrigger>
//         <GlassMenuSubContent>
//           <GlassMenuItem>Archive</GlassMenuItem>
//         </GlassMenuSubContent>
//       </GlassMenuSub>
//       <GlassMenuItem destructive onSelect={remove}>Delete</GlassMenuItem>
//     </GlassMenuContent>
//   </GlassMenu>
//
// Out of a button group: wrap the group and the content, and put the trigger on one of its items
// with `asChild`. The whole group's glass then grows into the menu.
//
//   <GlassMenu>
//     <GlassButtonGroup>
//       <GlassMenuTrigger asChild>
//         <GlassButtonGroupItem aria-label="More"><Ellipsis /></GlassButtonGroupItem>
//       </GlassMenuTrigger>
//     </GlassButtonGroup>
//     <GlassMenuContent align="end">…</GlassMenuContent>
//   </GlassMenu>
//
// `side` and `align` on the content say where the menu lies; the glass finds its own way there.
// Groups with a label, checkbox and radio items, shortcuts and submenus are parts of it.
// UI SDK owns the behaviour (keyboard, typeahead, focus, submenus, the top layer, positioning,
// ARIA); the kit's engine owns the material. Needs @ui-sdk/core and @ui-sdk/react.
// Without WebGL2 it is a plain frosted list.

import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemIndicator,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  type MenuProps,
  type MenuSubProps,
} from '@ui-sdk/react/menu'
import { Children, useContext, type ComponentProps, type ReactElement, type ReactNode } from 'react'

import { GlassCard } from './glass-card'
import { GlassPopupAnchor, GlassPopupContext, GlassPopupSurface, useGlassPopup } from './glass-popup'

export type GlassMenuProps = MenuProps

export type GlassMenuTriggerProps = {
  children?: ReactNode
  /** Render the trigger on the single child element: a GlassButtonGroupItem, whose group's glass then grows into the menu. */
  asChild?: boolean
  className?: string
} & Omit<ComponentProps<typeof MenuTrigger>, 'children' | 'className' | 'render'>

export type GlassMenuContentProps = { children?: ReactNode; className?: string } & Omit<ComponentProps<typeof MenuContent>, 'children' | 'className' | 'render'>

export type GlassMenuItemProps = { className?: string } & Omit<ComponentProps<typeof MenuItem>, 'className' | 'render'>

export type GlassMenuCheckboxItemProps = { children?: ReactNode; className?: string } & Omit<ComponentProps<typeof MenuCheckboxItem>, 'children' | 'className' | 'render'>

export type GlassMenuRadioItemProps = { children?: ReactNode; className?: string } & Omit<ComponentProps<typeof MenuRadioItem>, 'children' | 'className' | 'render'>

export type GlassMenuSubTriggerProps = { children?: ReactNode; className?: string } & Omit<ComponentProps<typeof MenuSubTrigger>, 'children' | 'className' | 'render'>

/** One row of the menu: an action, a checkbox, a radio or the trigger of a submenu. */
const ROW =
  'relative flex h-10 cursor-pointer items-center gap-2.5 rounded-2xl px-3.5 font-medium whitespace-nowrap outline-none select-none transition-colors duration-100 data-[disabled]:cursor-not-allowed data-[highlighted]:bg-current/10 [&_svg]:size-4 [&_svg]:shrink-0'
/** The surface's own words: the menu's, and a submenu's. */
const SURFACE = 'min-w-44 rounded-3xl p-1.5 text-[15px] text-neutral-900 outline-none data-[glass-tone=dark]:text-white data-[glass-tone=light]:text-neutral-900'

const icon = { 'aria-hidden': true, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export function GlassMenu({ children, ...options }: GlassMenuProps) {
  const popup = useGlassPopup({ opening: 'grow' })
  return (
    <Menu {...options}>
      <GlassPopupContext.Provider value={popup}>{children}</GlassPopupContext.Provider>
    </Menu>
  )
}

/**
 * The button whose glass becomes the menu. Round it for a single icon (`className="w-12 px-0"`, with an `aria-label`).
 * With `asChild`, an item of a GlassButtonGroup inside the GlassMenu: the group's glass is the one that grows.
 */
export function GlassMenuTrigger({ children, asChild = false, className = '', ...rest }: GlassMenuTriggerProps) {
  const popup = useContext(GlassPopupContext)
  if (asChild || !popup) return <MenuTrigger render={Children.only(children) as ReactElement} {...rest} />
  return (
    <MenuTrigger
      data-glass-host=""
      className={`inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full border border-black/10 bg-white/60 px-5 text-[15px] font-medium whitespace-nowrap text-neutral-900 outline-none select-none focus-visible:ring-2 focus-visible:ring-[#3291FF] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:bg-white/10 dark:text-white data-[glass-tone=dark]:text-white data-[glass-tone=light]:text-neutral-900 [&_svg]:size-4 [&_svg]:shrink-0 ${className}`}
      {...rest}
    >
      {popup && <GlassPopupAnchor popup={popup} />}
      {/* One element: the label softens and goes as the glass leaves it, and is back as the glass lands. */}
      <span className="inline-flex items-center gap-[inherit]">{children}</span>
    </MenuTrigger>
  )
}

/** The menu. `side` (default `bottom`) and `align` (default `start`) say where it lies against its button; it flips when there is no room. */
export function GlassMenuContent({ children, className = '', side = 'bottom', align = 'start', sideOffset = 8, ...rest }: GlassMenuContentProps) {
  const popup = useContext(GlassPopupContext)
  return (
    <MenuContent data-glass-popup="" data-glass-skip="" side={side} align={align} sideOffset={sideOffset} className={`group/glass ${SURFACE} ${className}`} {...rest}>
      {popup && <GlassPopupSurface popup={popup} />}
      {/* A submenu inside is a surface of its own, not this menu's. */}
      <GlassPopupContext.Provider value={null}>
        <div data-glass-list="" className="flex flex-col">
          {children}
        </div>
      </GlassPopupContext.Provider>
    </MenuContent>
  )
}

/** An action. Pressing it runs `onSelect` and closes the menu. `destructive` paints it red. */
export function GlassMenuItem({ className = '', ...rest }: GlassMenuItemProps) {
  return <MenuItem className={`${ROW} data-[destructive]:text-red-600 group-data-[glass-tone=dark]/glass:data-[destructive]:text-red-400 ${className}`} {...rest} />
}

/** An option that is on or off: `checked` / `defaultChecked` / `onCheckedChange`. The menu stays open unless `closeOnSelect`. */
export function GlassMenuCheckboxItem({ children, className = '', ...rest }: GlassMenuCheckboxItemProps) {
  return (
    <MenuCheckboxItem data-glass-item="" className={`${ROW} ${className}`} {...rest}>
      {children}
      <MenuItemIndicator className="ml-auto pl-4">
        <svg {...icon} strokeWidth={2.4}>
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </MenuItemIndicator>
    </MenuCheckboxItem>
  )
}

/** Radio items that share one value: `value` / `defaultValue` / `onValueChange`. */
export function GlassMenuRadioGroup({ className = '', ...rest }: { className?: string } & Omit<ComponentProps<typeof MenuRadioGroup>, 'className' | 'render'>) {
  return <MenuRadioGroup className={`flex flex-col ${className}`} {...rest} />
}

/** One choice in a GlassMenuRadioGroup. */
export function GlassMenuRadioItem({ children, className = '', ...rest }: GlassMenuRadioItemProps) {
  return (
    <MenuRadioItem data-glass-item="" className={`${ROW} ${className}`} {...rest}>
      {children}
      <MenuItemIndicator className="ml-auto pl-4">
        <span aria-hidden className="block size-2 rounded-full bg-current" />
      </MenuItemIndicator>
    </MenuRadioItem>
  )
}

/** Items that belong together, named by a GlassMenuLabel inside. */
export function GlassMenuGroup({ className = '', ...rest }: { className?: string } & Omit<ComponentProps<typeof MenuGroup>, 'className' | 'render'>) {
  return <MenuGroup className={`flex flex-col ${className}`} {...rest} />
}

/** The quiet heading of a group. */
export function GlassMenuLabel({ className = '', ...rest }: { className?: string } & Omit<ComponentProps<typeof MenuGroupLabel>, 'className' | 'render'>) {
  return <MenuGroupLabel className={`px-3.5 pt-2 pb-1 text-xs font-medium opacity-55 select-none ${className}`} {...rest} />
}

/** The keys of an item's shortcut, at its end: `⌘S`. */
export function GlassMenuShortcut({ className = '', ...rest }: { className?: string } & Omit<ComponentProps<typeof MenuShortcut>, 'className' | 'render'>) {
  return <MenuShortcut className={`ml-auto pl-6 text-[13px] font-normal tracking-wide opacity-50 ${className}`} {...rest} />
}

/** A hairline between items. */
export function GlassMenuSeparator({ className = '' }: { className?: string }) {
  return <MenuSeparator className={`mx-3.5 my-1 h-px shrink-0 bg-current/15 ${className}`} />
}

/** A submenu: a GlassMenuSubTrigger and a GlassMenuSubContent, inside a menu's content. */
export function GlassMenuSub(props: MenuSubProps) {
  return <MenuSub {...props} />
}

/** The row that opens its submenu, on hover, a press or the arrow key. */
export function GlassMenuSubTrigger({ children, className = '', ...rest }: GlassMenuSubTriggerProps) {
  return (
    <MenuSubTrigger data-glass-item="" className={`${ROW} data-[open]:bg-current/10 ${className}`} {...rest}>
      {children}
      <svg {...icon} className="ml-auto opacity-50 rtl:-scale-x-100">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </MenuSubTrigger>
  )
}

/** The submenu: a card of the same glass beside its row. It fades in where it lies, and out again. */
export function GlassMenuSubContent({ children, className = '', sideOffset = 14, alignOffset = -6, ...rest }: GlassMenuContentProps) {
  const tone = 'data-[glass-tone=dark]:[&_[data-destructive]]:text-red-400'
  return (
    <MenuSubContent
      data-glass-skip=""
      // Measured from the row, which lies 6px inside its menu: 8px clear of the menu's edge, the first rows level.
      sideOffset={sideOffset}
      alignOffset={alignOffset}
      // (Never a scroll box: the glass is drawn a little past the card's own box.)
      render={<GlassCard className={`${SURFACE} overflow-visible! transition-[opacity,scale] duration-150 ease-out data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0 motion-reduce:scale-100! ${tone} ${className}`} />}
      {...rest}
    >
      <div className="flex flex-col">{children}</div>
    </MenuSubContent>
  )
}

export default GlassMenu
