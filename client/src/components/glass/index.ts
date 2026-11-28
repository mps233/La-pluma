/**
 * The application-facing Liquid Glass surface.
 *
 * The vendored registry lives in `components/liquid-glass/` and is copied
 * verbatim from upstream. Application code imports glass primitives from this
 * module only, so a kit upgrade touches one adapter instead of every page.
 * The registry itself is the only other place allowed to import its files.
 * See `README.md` for the surface and the preview exception.
 */
export {
  GlassActionButton,
  GlassBadge,
  GlassButton,
  GlassButtonGroup,
  GlassButtonGroupItem,
  GlassCard,
  GlassLens,
  GlassPopupAnchor,
  GlassPopupSurface,
  GlassPopupText,
  GlassSlideToConfirm,
  GlassTabs,
  useGlassPopup,
  type GlassActionButtonProps,
  type GlassBadgeProps,
  type GlassButtonGroupItemProps,
  type GlassButtonGroupProps,
  type GlassButtonProps,
  type GlassButtonSize,
  type GlassCardProps,
  type GlassLensProps,
  type GlassPopup,
  type GlassPopupFrom,
  type GlassPopupOpening,
  type GlassSlideState,
  type GlassSlideToConfirmProps,
  type GlassTabOption,
  type GlassTabsProps,
} from '@/components/liquid-glass'

export {
  GlassDropdownMenu,
  GlassDropdownMenuContent,
  GlassDropdownMenuItem,
  GlassDropdownMenuSeparator,
  GlassDropdownMenuTrigger,
  type GlassDropdownMenuContentProps,
  type GlassDropdownMenuItemProps,
  type GlassDropdownMenuProps,
  type GlassDropdownMenuTriggerProps,
} from '@/components/liquid-glass/glass-dropdown-menu'

export {
  GlassSelect,
  type GlassSelectOption,
  type GlassSelectProps,
} from '@/components/liquid-glass/glass-select'

export {
  Checkbox as GlassCheckbox,
  type CheckboxProps as GlassCheckboxProps,
} from '@/components/liquid-glass/controls/Checkbox'

export {
  Switch as GlassSwitch,
  type SwitchProps as GlassSwitchProps,
} from '@/components/liquid-glass/controls/Switch'

export {
  GlassSegmented,
  type GlassSegmentedOption,
  type GlassSegmentedProps,
} from './GlassSegmented'

export {
  GlassSearch,
  type GlassSearchItem,
  type GlassSearchLayer,
  type GlassSearchProps,
} from '@/components/liquid-glass/glass-search'
