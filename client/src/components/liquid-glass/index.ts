// Liquid Glass — glass components (React 19 + Tailwind CSS v4), drawn by one dependency-free engine.
// GlassButton and GlassTabs take their behaviour from UI SDK (@ui-sdk/core, @ui-sdk/react).
// Copy the whole `liquid-glass/` folder, or install with the shadcn CLI (see README).
//
//   GlassButton        press   — swells under the pointer, bends the page behind it
//   GlassActionButton  merge   — its arrow is a droplet that melts in when pressed, and stays
//   GlassTabs          travel  — the selection travels as a magnifying lens
//   GlassBadge         flow    — text flows through the glass
//   GlassSlideToConfirm drag  — drag the glass thumb to the end to confirm
//   GlassCard          hold    — a card of glass: holds your content, its rim bends what slides behind
//   GlassButtonGroup   share   — related actions share one body of glass
export { GlassButton, type GlassButtonProps, type GlassButtonSize } from './glass-button'
export { GlassActionButton, type GlassActionButtonProps, type GlassActionState } from './glass-action-button'
export { GlassTabs, type GlassTabsProps, type GlassTabOption } from './glass-tabs'
export { GlassBadge, type GlassBadgeProps } from './glass-badge'
export { GlassSlideToConfirm, type GlassSlideToConfirmProps, type GlassSlideState, type GlassSlideSize } from './glass-slide-to-confirm'
export { GlassCard, type GlassCardProps } from './glass-card'
export {
  GlassButtonGroup,
  GlassButtonGroupItem,
  GlassButtonGroupSeparator,
  GlassButtonGroupText,
  type GlassButtonGroupProps,
  type GlassButtonGroupItemProps,
  type GlassButtonGroupSize,
  type GlassButtonGroupOrientation,
} from './glass-button-group'
// Building blocks: GlassLens puts the travelling lens on your own tabs (Radix Tabs, a radiogroup).
export { GlassLens, type GlassLensProps } from './glass-lens'
// GlassPopup makes a popup (a select's list, a menu, a popover) one body with the control that opens it: on a neck (`stretch`), over the control (`morph`) or grown out of it (`grow`).
export { GlassPopupAnchor, GlassPopupSurface, GlassPopupText, useGlassPopup, type GlassPopup, type GlassPopupFrom, type GlassPopupOpening } from './glass-popup'
export { GlassLayer, GlassStyles, GLASS_CSS, type GlassLayerProps, type GlassMaterial, type GlassDroplet, type GlassOptics } from './glass-layer'
