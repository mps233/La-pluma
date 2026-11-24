---
name: liquid-glass
description: "Add liquid glass UI to a React app with Liquid Glass UI (bilalgursen/liquid-glass) — copy-paste components, one verb each: glass buttons (press), async action buttons whose arrow droplet melts into the body when pressed (merge), tabs whose selection travels as a lens (travel), badges with text flowing through the glass (flow), slide-to-confirm tracks with a glass thumb (drag), glass cards that hold content over moving colour (hold), button groups that share one body of glass (share), range sliders (slide), on/off switches (flip), checkboxes (tick) selects whose list stretches out of the button (stretch) and dropdown menus that pour out of a button or a whole button group (open). Use when the user asks for liquid glass, glassmorphism with real refraction, Apple-style glass, glass cards or widgets, glass sliders, switches / toggles or checkboxes, gooey/droplet buttons, slide to confirm / slide to pay / slide to unlock, or mentions Liquid Glass UI. Installs the real component files instead of re-implementing them."
---

# Liquid Glass UI

Copy-paste React components drawn by one WebGL2 glass shader, one verb each. Docs: https://liquid-glass-interface.pages.dev — every page also exists as Markdown (`/docs/<page>.md`), and `https://liquid-glass-interface.pages.dev/llms-full.txt` holds everything.

## Non-negotiable rules

1. **Install, never re-implement.** Use the shadcn command below, or copy files from https://github.com/bilalgursen/liquid-glass/tree/main/src/components byte for byte. Do not write your own shader, port the engine to another library, "simplify" it, or translate identifiers. The look depends on exact constants.
2. **Do not edit files in `components/liquid-glass/`.** Customise only through documented props, `className` (`bg-*`, `text-*`, sizes, position) and the `--glass-tint` CSS variable.
3. **Copy the examples as they are.** The code in `references/components.md` is the exact source of each live demo.
4. Requirements: React 19, Tailwind CSS v4, an `@/` import alias to the source folder. Files already start with `"use client"`.

## Which component

Pick by the verb. They never overlap.

| Verb | Need | Use | Install |
| --- | --- | --- | --- |
| Press | One glass button, or a router link styled as one | `GlassButton` (`material`: `clear` \| `tinted`; `asChild` for `<Link>`; needs `@ui-sdk/core` and `@ui-sdk/react`) | `…/r/button.json` |
| Merge | One async action whose result shows on the button (Deploy → Deploying… → Deployed ✓) | `GlassActionButton` — its arrow is a gooey droplet | `…/r/action-button.json` |
| Travel | Tabs / segmented control with a sliding glass lens | `GlassTabs`; for your own Radix Tabs or radio group, `GlassLens` (ships with it); needs `@ui-sdk/core` and `@ui-sdk/react` | `…/r/tabs.json` |
| Flow | A one-word "New" badge with text flowing through glass | `GlassBadge` | `…/r/badge.json` |
| Drag | A deliberate action a stray tap must not trigger (Slide to send $240 → Sending… → Sent ✓) | `GlassSlideToConfirm` (`fillClassName` colours the fill) | `…/r/slide-to-confirm.json` |
| Hold | A small card of content over colour, imagery or motion (a weather widget, a now-playing card) | `GlassCard` (frosted: `blur` 3.5 px, `tint` 0.68 light / 0.79 dark; `live` when something moves behind it) | `…/r/card.json` |
| Share | Two to five related actions in one body of glass (a toolbar, map controls, a split button) | `GlassButtonGroup` with `GlassButtonGroupItem`, `GlassButtonGroupSeparator`, `GlassButtonGroupText` (`orientation`, `size`, `material`) | `…/r/button-group.json` |
| Slide | Picking a value on a range (volume, brightness) | `RangeSlider` from `controls/RangeSlider` (`value`, `onChange`, `min`, `max`, `step`, `label`; needs `three`, `@ui-sdk/core` and `@ui-sdk/react`) | `…/r/slider.json` |
| Flip | An on/off setting that takes effect at once | `Switch` from `controls/Switch` (`checked`, `onChange`, `label`; needs `three`, `@ui-sdk/core` and `@ui-sdk/react`) | `…/r/switch.json` |
| Tick | Choosing items in a list or a form | `Checkbox` from `controls/Checkbox` (`checked`, `onChange`, `label`; needs `three`, `@ui-sdk/core` and `@ui-sdk/react`) | `…/r/checkbox.json` |
| Stretch | Picking one option from a list that opens out of its button | `GlassSelect` from `glass-select` (`label`, `options`, `value`, `onValueChange`; needs `@ui-sdk/core` and `@ui-sdk/react`); for your own menu or popover, `GlassPopup` (ships with it) | `…/r/select.json` |
| Open | A menu of actions out of a button or out of a button group's three dots | `GlassDropdownMenu` from `glass-dropdown-menu` with `GlassDropdownMenuTrigger` (`asChild` on a `GlassButtonGroupItem`), `GlassDropdownMenuContent`, `GlassDropdownMenuItem` (`onSelect`, `destructive`), `GlassDropdownMenuSeparator`; needs `@ui-sdk/core` and `@ui-sdk/react` | `…/r/dropdown-menu.json` |
| — | All of them | — | `…/r/liquid-glass.json` |

`…` = `npx shadcn@latest add https://liquid-glass-interface.pages.dev`. Everything wraps your own DOM. `GlassButton`, `GlassTabs`, `GlassSelect`, `GlassDropdownMenu`, `RangeSlider`, `Switch` and `Checkbox` take their behaviour from UI SDK and need `@ui-sdk/core` and `@ui-sdk/react` (in beta: keep the exact versions the install adds); `RangeSlider`, `Switch` and `Checkbox` also need `three`. The rest have zero npm dependencies.

## Essentials

```tsx
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { GlassActionButton, GlassButton, GlassTabs } from '@/components/liquid-glass'

// Clear glass bends whatever is behind it; tinted glass takes the background class.
<GlassButton icon={<ArrowRight />}>Get started</GlassButton>
<GlassButton material="tinted" className="bg-orange-500 text-white">Continue</GlassButton>

// The glass on your own element (keeps its navigation).
<GlassButton asChild><Link href="/docs">Read the docs</Link></GlassButton>

// The arrow floats apart as a droplet; pressed, it melts in and stays merged.
<GlassActionButton material="tinted" className="bg-neutral-900 text-white"
  pendingLabel="Deploying" successLabel="Deployed" onAction={deploy}>
  Deploy
</GlassActionButton>

<GlassTabs aria-label="Range" value={v} onValueChange={setV}
  options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }]} />
```

- `GlassSlideToConfirm` takes its instruction as `children` (a string) and fills its container: `<GlassSlideToConfirm pendingLabel="Sending" successLabel="Sent" onConfirm={send}>Slide to send $240</GlassSlideToConfirm>`. Return the real promise from `onConfirm`; a rejection springs the thumb back and shows `errorLabel`.
- `GlassActionButton`'s arrow is a gooey droplet. Return the real promise from `onAction`; use `resetAfter` (ms) if it should split off again after success. At most one per screen.
- `GlassButtonGroup` is the glass; its items are plain buttons (`GlassButtonGroupItem`). Never put a `GlassButton` inside it. It is tinted white by default: colour it with a `bg-*` class on the group, or pass `material="clear"`. Nest groups to set some actions apart.
- `GlassDropdownMenu` is imported from `glass-dropdown-menu`, not the index, and needs `@ui-sdk/core` and `@ui-sdk/react`. To open it from a button group, wrap that one `GlassButtonGroup` and the content in it and put `GlassDropdownMenuTrigger asChild` around one `GlassButtonGroupItem`.
- `GlassSelect` is imported from `glass-select`, not the index, and needs `@ui-sdk/core` and `@ui-sdk/react` (UI SDK is in beta: keep the exact versions the install adds). It is clear glass: give it something to bend. For your own menu or popover use `GlassPopup` (`useGlassPopup`, `GlassPopupAnchor`, `GlassPopupSurface`): the content must carry `data-open` / `data-ending-style` and stay mounted while it animates out, as UI SDK's popups do.
- Without WebGL2 or before the first frame, components show their plain CSS look. Reduced motion freezes the glass. Do not add your own fallbacks.
- Dark mode: the glass reads colours from CSS (any theme system works); clear glass picks its text colour from its own tone.

## Reference

- `references/components.md` — every component page: live example source, props table.
- Turkish docs: https://liquid-glass-interface.pages.dev/tr/docs
