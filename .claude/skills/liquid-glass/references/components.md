<!-- Generated from src/docs/content.ts by scripts/ai-files.ts. Do not edit by hand. -->

# GlassButton

> A button made of glass. Clear glass bends the page behind it; tinted glass takes your background colour.

```tsx
import { Play } from 'lucide-react'

import { GlassButton } from '@/components/liquid-glass'

const COLS = 13
const ROWS = 7

/** 1 around the middle of the grid, falling to 0 at its edge. */
const fade = (col: number, row: number) => {
  const distance = Math.hypot((col - (COLS - 1) / 2) / (COLS / 2), (row - (ROWS - 1) / 2) / (ROWS / 2))
  return Math.min(1, Math.max(0, (1 - distance) / 0.45))
}

// Clear glass bends whatever sits behind it: here, only a fine grid centred on the glass,
// on the page's own colour. Watch its lines bend at the rim. The grid is plain DOM: every
// cell draws its own top and left line, fainter the further it is from the glass.
export default function Demo() {
  return (
    <div className="relative isolate flex h-72 w-full max-w-xl items-center justify-center">
      <div aria-hidden className="absolute top-1/2 left-1/2 -z-10 grid -translate-x-1/2 -translate-y-1/2 grid-cols-[repeat(13,40px)]">
        {Array.from({ length: COLS * ROWS }, (_, i) => (
          <span key={i} className="relative size-10" style={{ opacity: fade(i % COLS, Math.floor(i / COLS)) }}>
            <span className="absolute inset-x-0 top-0 h-px bg-black/10 dark:bg-white/10" />
            <span className="absolute inset-y-0 left-0 w-px bg-black/10 dark:bg-white/10" />
          </span>
        ))}
      </div>
      <GlassButton size="xl" tint={0} icon={<Play />} iconPosition="start">
        Play
      </GlassButton>
    </div>
  )
}
```

**Use it for**

- One action: a call to action, a toolbar button, a link that looks like a button.
- Clear glass over imagery or colour, where the bend shows.

**Not for**

- An async action whose result should show on the button: use GlassActionButton.
- Choosing between options: use GlassTabs.
- Every button of a dense form: keep the glass for the action that matters.

```bash
npx shadcn@latest add https://liquid-glass-interface.pages.dev/r/button.json
```

> The button underneath is UI SDK's, so Button needs `@ui-sdk/core` and `@ui-sdk/react`. Return a Promise from `onClick` and the button stays pending until it settles: it ignores further presses and says so to screen readers. The install command adds both packages at the exact version this was built on: UI SDK is in beta and its API may still change.

## Usage

```tsx
import { GlassButton } from '@/components/liquid-glass'

<GlassButton>Get started</GlassButton>
<GlassButton material="tinted" className="bg-sky-500 text-white">Save</GlassButton>
<GlassButton asChild>
  <Link href="/docs">Read the docs</Link>
</GlassButton>
```

## Examples

### Tinted colours and sizes

```tsx
import { GlassButton } from '@/components/liquid-glass'

// Tinted glass takes the button's own background class, then adds light and shadow.
// Top row: your colours. Bottom row: the four sizes.
export default function Demo() {
  return (
    <div className="flex flex-col items-center gap-10">
      <div className="flex flex-wrap items-center justify-center gap-3">
        <GlassButton material="tinted" size="lg" className="bg-blue-600 text-white">
          Continue
        </GlassButton>
        <GlassButton material="tinted" size="lg" className="bg-neutral-900 text-white dark:bg-white dark:text-neutral-900">
          Publish
        </GlassButton>
        <GlassButton material="tinted" size="lg" className="bg-rose-600 text-white">
          Delete
        </GlassButton>
        <GlassButton material="tinted" size="lg" className="border border-black/15 bg-white text-neutral-900">
          Cancel
        </GlassButton>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <GlassButton material="tinted" size="sm" className="bg-emerald-600 text-white">
          Small
        </GlassButton>
        <GlassButton material="tinted" size="md" className="bg-emerald-600 text-white">
          Medium
        </GlassButton>
        <GlassButton material="tinted" size="lg" className="bg-emerald-600 text-white">
          Large
        </GlassButton>
        <GlassButton material="tinted" size="xl" className="bg-emerald-600 text-white">
          Extra large
        </GlassButton>
      </div>
    </div>
  )
}
```

Colour tinted glass with a normal class such as `bg-sky-500`; the glass paints itself in that colour and adds light and shadow. A `border-*` class becomes the glass rim.

### As a link (asChild)

```tsx
import { ArrowUpRight } from 'lucide-react'

import { GlassButton } from '@/components/liquid-glass'

// `asChild` puts the glass on your own element. The same works with a Next.js or
// TanStack Router <Link>: it stays a real link with its own navigation.
export default function Demo() {
  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div>
        <p className="text-3xl font-semibold tracking-tight text-neutral-900 dark:text-white">Free and open source</p>
        <p className="mt-2 text-base text-neutral-500 dark:text-neutral-400">MIT licensed. Copy the files, they are yours.</p>
      </div>
      <GlassButton asChild material="tinted" size="lg" icon={<ArrowUpRight />} className="bg-violet-600 text-white">
        <a href="https://github.com/bilalgursen/liquid-glass" target="_blank" rel="noreferrer">
          Star on GitHub
        </a>
      </GlassButton>
    </div>
  )
}
```

With `asChild` the glass goes on your single child element instead of a `<button>`: an `<a>`, a Next.js `<Link>`, a TanStack Router `<Link>`. Your element keeps its own props and navigation.

### Over colour with a scrim

```tsx
import { ArrowRight, Play } from 'lucide-react'

import { GlassButton } from '@/components/liquid-glass'

// Clear glass over colour. The backdrop is plain DOM: flat discs of colour on a dark scene
// and a dark scrim over them. The glass sees both, and the text, so the buttons sit in the scene.
export default function Demo() {
  return (
    <div className="relative isolate flex h-96 w-full max-w-2xl flex-col items-start justify-end overflow-hidden rounded-3xl bg-[#0b1030] p-8">
      <div aria-hidden className="absolute inset-0 -z-20">
        <span className="absolute -top-24 -left-16 size-80 rounded-full bg-[#22d3ee]" />
        <span className="absolute -top-32 right-4 size-72 rounded-full bg-[#a855f7]" />
        <span className="absolute -right-20 -bottom-28 size-96 rounded-full bg-[#ec4899]" />
        <span className="absolute -bottom-40 left-24 size-80 rounded-full bg-[#1d4ed8]" />
      </div>
      <div aria-hidden className="absolute inset-0 -z-10 bg-black/35" />
      <p className="text-xs font-semibold tracking-[0.18em] text-white/70">TROMSØ · WINTER SEASON</p>
      <h3 className="mt-2 max-w-sm text-4xl leading-[1.05] font-semibold tracking-tight text-white">Chase the northern lights</h3>
      <div className="mt-6 flex flex-wrap gap-3">
        <GlassButton size="lg" tint={0.35} icon={<ArrowRight />}>
          Plan the trip
        </GlassButton>
        <GlassButton size="lg" tint={0.15} icon={<Play />} iconPosition="start">
          Watch the film
        </GlassButton>
      </div>
    </div>
  )
}
```

Clear glass repaints what lies behind it: background colours, gradients and images, `<img>` and `<video>` the way the page crops them (`object-fit`), text, inline SVG icons and backdrop blur, in their stacking order. Shadows, `::before`/`::after` and conic gradients are not painted.

> An image from another origin must be served with CORS headers (image CDNs usually send them): the glass requests it again with CORS, and leaves it out if the server refuses.

### Square corners

```tsx
import { Plus } from 'lucide-react'

import { GlassButton } from '@/components/liquid-glass'

// The glass takes the button's own corners: add a `rounded-*` class and the lens follows.
// Fine ruled lines show the bend running along the straight edges and around each corner.
export default function Demo() {
  return (
    <div className="relative isolate flex h-72 w-full max-w-2xl flex-wrap items-center justify-center gap-4 overflow-hidden rounded-3xl">
      <div aria-hidden className="absolute inset-0 -z-10 flex flex-col justify-between">
        {Array.from({ length: 33 }, (_, i) => (
          <span key={i} className="h-px bg-black/10 dark:bg-white/10" />
        ))}
      </div>
      <GlassButton size="xl" tint={0.3} className="rounded-2xl" icon={<Plus />} iconPosition="start">
        New project
      </GlassButton>
      <GlassButton size="xl" material="tinted" className="rounded-2xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900">
        Open
      </GlassButton>
    </div>
  )
}
```

The glass takes the corners of the element it sits on. Add a `rounded-*` class and the lens, its rim and its shadow follow; the bend stays as deep as on a pill.

## API reference

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `material` | `'clear' \| 'tinted'` | `'clear'` | Clear bends the page; tinted uses the background colour. |
| `size` | `'sm' \| 'md' \| 'lg' \| 'xl'` | `'md'` | Height 32, 40, 48 or 64 px. |
| `icon` | `ReactNode` | — | An icon element (e.g. a lucide-react icon). |
| `iconPosition` | `'start' \| 'end'` | `'end'` | Which side the icon sits on. |
| `tint` | `number` | `0.6` | Clear glass only: how much tint covers the backdrop (0–1). |
| `asChild` | `boolean` | `false` | Put the glass on the single child element instead of a `<button>`. |
| `…rest` | `button attributes` | — | Passed to the button: `onClick`, `disabled`, `type`, and UI SDK's `pendingAnnouncement` and `focusableWhenDisabled`. |

## Accessibility

- A real `<button>` (or your own element with `asChild`): focus, Enter and Space work as usual.
- The glass canvas is `aria-hidden`; only your label is announced.
- Icon-only buttons need an `aria-label`.

Source: https://liquid-glass-interface.pages.dev/docs/button

# GlassActionButton

> A button for one async action. Its arrow floats apart as a glass droplet; press it and the droplet melts into the body, and stays.

```tsx
import { RotateCcw } from 'lucide-react'
import { useState } from 'react'

import { GlassActionButton } from '@/components/liquid-glass'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Press it: the arrow droplet melts into the button and stays merged.
export default function Demo() {
  const [run, setRun] = useState(0)
  return (
    <div className="flex flex-col items-center gap-6">
      <GlassActionButton
        key={run}
        size="lg"
        material="tinted"
        className="bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
        pendingLabel="Deploying"
        successLabel="Deployed"
        onAction={() => wait(1400)}
      >
        Deploy to production
      </GlassActionButton>
      <button
        type="button"
        onClick={() => setRun((n) => n + 1)}
        className="flex cursor-pointer items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
      >
        <RotateCcw className="size-3.5" />
        Start over
      </button>
    </div>
  )
}
```

**Use it for**

- One async commit whose result belongs on the button: Deploy, Publish, Add to cart, Subscribe.
- Actions that stay done: the merged "Deployed ✓" is the new state of the page.

**Not for**

- Plain links and instant actions: use GlassButton.
- Toggling back and forth between two states: use GlassTabs.
- More than one per screen: the droplet is the kit's one gooey effect, keep it special.

```bash
npx shadcn@latest add https://liquid-glass-interface.pages.dev/r/action-button.json
```

## Usage

```tsx
import { GlassActionButton } from '@/components/liquid-glass'

<GlassActionButton
  material="tinted"
  className="bg-neutral-900 text-white"
  pendingLabel="Deploying"
  successLabel="Deployed"
  onAction={deploy} // return the promise
>
  Deploy
</GlassActionButton>
```

## The flow

- **Idle.** The arrow floats apart from the body as a separate glass droplet.
- **Press.** The droplet stretches back on a gooey bridge and melts into the body.
- **Pending.** One body; the label morphs to `pendingLabel` and a spinner turns where the arrow was, until the promise from `onAction` settles.
- **Success.** Still one body: `successLabel` and a check that draws itself in. It stays merged, unless you set `resetAfter`.
- **Error.** If `onAction` throws, the droplet splits off again and `onActionError` gets the error.

## Examples

### Reset after success, and a failing action

```tsx
import { Plus } from 'lucide-react'

import { GlassActionButton } from '@/components/liquid-glass'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Left: `resetAfter` splits the droplet off again after a success.
// Right: a rejected action splits it off at once, and `onActionError` gets the error.
export default function Demo() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-5">
      <GlassActionButton
        size="lg"
        material="tinted"
        className="bg-blue-600 text-white"
        icon={<Plus />}
        pendingLabel="Adding"
        successLabel="Added"
        resetAfter={2400}
        onAction={() => wait(900)}
      >
        Add to cart
      </GlassActionButton>
      <GlassActionButton
        size="lg"
        material="tinted"
        className="bg-rose-600 text-white"
        pendingLabel="Sending"
        onAction={() => wait(900).then(() => Promise.reject(new Error('Offline')))}
        onActionError={(error) => console.warn(error)}
      >
        Send (fails)
      </GlassActionButton>
    </div>
  )
}
```

With `resetAfter={2400}` the droplet splits off again 2.4 seconds after a success, ready for the next press. Any icon element can be the droplet with `icon`; the spinner and the check are built in.

## API reference

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `ReactNode` | — | The idle label, and the button's accessible name. |
| `onAction` | `() => unknown` | — | Required. Runs on press; return a promise to stay pending until it settles. |
| `onActionError` | `(error) => void` | — | Called when `onAction` throws; the button returns to idle. |
| `pendingLabel` | `ReactNode` | `children` | Label while `onAction` runs. |
| `successLabel` | `ReactNode` | `children` | Label after it succeeds. |
| `resetAfter` | `number` | `0` | Milliseconds before splitting off again after a success. `0` stays merged. |
| `icon` | `ReactNode` | `arrow` | The droplet's idle icon. |
| `material` | `'clear' \| 'tinted'` | `'clear'` | As on GlassButton. |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Height 32, 40 or 48 px. |
| `…rest` | `button attributes` | — | Passed to the `<button>` (not `onClick`: use `onAction`). |

## Accessibility

- A real `<button>`; Enter and Space run the action.
- Pending sets `aria-busy`, and pending or done sets `aria-disabled` instead of `disabled`, so focus stays on the button.
- A `role="status"` region announces the pending and success labels.
- With reduced motion the droplet and labels switch without animation.

Source: https://liquid-glass-interface.pages.dev/docs/action-button

# GlassTabs

> A segmented control whose selection travels as a glass lens.

```tsx
import NumberFlow from '@number-flow/react'
import { useState } from 'react'

import { GlassTabs } from '@/components/liquid-glass'

const distance = { day: 8.4, week: 52.1, month: 214, year: 2480 }

// Click or drag: the selection slides as a lens that bends the labels it passes.
// The figure rolls to its new value with NumberFlow (`@number-flow/react`).
export default function Demo() {
  const [range, setRange] = useState<keyof typeof distance>('week')
  return (
    <div className="flex flex-col items-center gap-8">
      <div className="text-center">
        <p className="text-6xl font-semibold tracking-tight text-neutral-900 tabular-nums dark:text-white">
          <NumberFlow value={distance[range]} locales="en-US" />
          <span className="ml-1.5 text-2xl font-medium text-neutral-400 dark:text-neutral-500">km</span>
        </p>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Distance this {range}</p>
      </div>
      <GlassTabs
        aria-label="Range"
        size="lg"
        value={range}
        onValueChange={setRange}
        options={[
          { value: 'day', label: 'Day' },
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
          { value: 'year', label: 'Year' },
        ]}
      />
    </div>
  )
}
```

**Use it for**

- Switching a view or a range in place: Day / Week / Month, List / Grid.
- Two to five short options.

**Not for**

- Navigating between pages: use links.
- Long lists of options: use a select.

```bash
npx shadcn@latest add https://liquid-glass-interface.pages.dev/r/tabs.json
```

> The behaviour (one tab stop, arrow keys, a hidden radio per option for forms) comes from UI SDK's segmented control, so Tabs needs `@ui-sdk/core` and `@ui-sdk/react`. The install command adds them at the exact version this was built on: UI SDK is in beta and its API may still change.

## Usage

```tsx
import { GlassTabs } from '@/components/liquid-glass'

const [view, setView] = useState('week')

<GlassTabs
  aria-label="Range"
  value={view}
  onValueChange={setView}
  options={[
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
  ]}
/>
```

## Examples

### With icons

```tsx
import { LayoutGrid, List, Rows3 } from 'lucide-react'
import { useState } from 'react'

import { GlassTabs } from '@/components/liquid-glass'

// What each layout looks like: how many blocks, in how many columns, how tall.
const layouts = {
  list: { blocks: 4, columns: 'grid-cols-1', block: 'h-6' },
  grid: { blocks: 6, columns: 'grid-cols-3', block: 'h-14' },
  rows: { blocks: 2, columns: 'grid-cols-1', block: 'h-14' },
}

// Icons next to the labels, at a larger size.
export default function Demo() {
  const [layout, setLayout] = useState<keyof typeof layouts>('grid')
  const { blocks, columns, block } = layouts[layout]
  return (
    <div className="flex flex-col items-center gap-8">
      <div aria-hidden className={`grid h-[120px] w-72 content-start gap-2 ${columns}`}>
        {Array.from({ length: blocks }, (_, i) => (
          <span key={i} className={`rounded-lg bg-black/10 dark:bg-white/10 ${block}`} />
        ))}
      </div>
      <GlassTabs
        aria-label="Layout"
        size="lg"
        value={layout}
        onValueChange={setLayout}
        options={[
          { value: 'list', label: 'List', icon: <List /> },
          { value: 'grid', label: 'Grid', icon: <LayoutGrid /> },
          { value: 'rows', label: 'Rows', icon: <Rows3 /> },
        ]}
      />
    </div>
  )
}
```

When the selection changes, the highlight leaves its option, becomes clear glass that bends the labels it passes, and settles as a flat pill again. Press and hold to open the lens in place; drag and release to choose.

## Your own markup

Already have tabs (Radix Tabs, your own radio group)? Put the lens on them with `GlassLens`, which ships with GlassTabs:

- The container is `relative isolate` and `<GlassLens value={value} />` is its first child.
- Options carry `role="radio"` or `role="tab"` (Radix Tabs works as is)
- The selected option contains the resting highlight, marked `data-glass-highlight`. Its background colour is the lens colour and its corners are the lens corners: `rounded-full` travels as a pill, `rounded-lg` as a rounded rectangle.
- Hide the highlight while the lens moves: `[[data-glass-moving]_&]:opacity-0`.

### A billing switch with GlassLens

```tsx
import NumberFlow from '@number-flow/react'
import { useState } from 'react'

import { GlassLens } from '@/components/liquid-glass'

const plans = {
  Monthly: { price: 12, note: 'per month, cancel any time' },
  Yearly: { price: 96, note: 'per year, four months free' },
}
type Plan = keyof typeof plans
const usd = { style: 'currency', currency: 'USD', maximumFractionDigits: 0 } as const

// Your own segmented control: role="radio" options and a `data-glass-highlight` pill.
// The price rolls to its new value with NumberFlow (`@number-flow/react`).
export default function Demo() {
  const [plan, setPlan] = useState<Plan>('Yearly')
  return (
    <div className="flex flex-col items-center gap-8">
      <div className="text-center">
        <p className="text-6xl font-semibold tracking-tight text-neutral-900 tabular-nums dark:text-white">
          <NumberFlow value={plans[plan].price} locales="en-US" format={usd} />
        </p>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">{plans[plan].note}</p>
      </div>
      <div role="radiogroup" aria-label="Billing" className="relative isolate inline-flex gap-1 rounded-2xl bg-neutral-900 p-1.5">
        <GlassLens value={plan} />
        {(Object.keys(plans) as Plan[]).map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={p === plan}
            onClick={() => setPlan(p)}
            className={`relative h-11 cursor-pointer rounded-xl px-7 text-[15px] font-semibold ${
              p === plan ? 'text-neutral-900 [[data-glass-traveling]_&]:text-white/60' : 'text-white/60'
            }`}
          >
            {p === plan && <span data-glass-highlight className="absolute inset-0 rounded-xl bg-white [[data-glass-moving]_&]:opacity-0" />}
            <span className="relative z-20">{p}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
```

## API reference

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `options` | `{ value, label, icon?, aria-label? }[]` | — | The segments. |
| `value` | `string \| null` | — | Selected value (controlled). |
| `onValueChange` | `(value) => void` | — | Called with the new value. |
| `aria-label` | `string` | — | Required: names the group for screen readers. |
| `name` | `string` | — | Submits the selected value under this name with the form around it. |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Segment height 28, 32 or 40 px. |
| `highlightClassName` | `string` | `'bg-white dark:bg-neutral-700'` | Classes of the resting pill; its background is the lens colour. |
| `GlassLens value` | `string \| number \| null` | — | Your own markup: the selected value; any change moves the lens. |
| `GlassLens disabled` | `boolean` | `false` | No lens; the highlight simply jumps. |

## Accessibility

- Radiogroup pattern: one tab stop, arrow keys move the selection.
- Icon-only options take an `aria-label` each.
- With reduced motion the pill simply jumps.

Source: https://liquid-glass-interface.pages.dev/docs/tabs

# GlassBadge

> A small glass badge with its text flowing through the lens.

```tsx
import { useEffect, useState } from 'react'

import { GlassBadge } from '@/components/liquid-glass'

// A plain card with one orange badge on its corner. Hover the card: the text flows faster.
export default function Demo() {
  // The month we are in, in Turkish. Set after mount: a prerendered page may be months old.
  const [month, setMonth] = useState('Kasım')
  useEffect(() => {
    setMonth(new Intl.DateTimeFormat('tr-TR', { month: 'long' }).format(new Date()))
  }, [])

  return (
    <div className="relative w-full max-w-xs rounded-[28px] border border-neutral-950/15 p-6 dark:border-white/20">
      <p className="font-display text-2xl text-neutral-950 dark:text-white">{month}</p>
      <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">Sliders, switches and checkboxes, now in liquid glass.</p>
      <GlassBadge className="absolute -top-2.5 -right-2.5 bg-orange-600">New</GlassBadge>
    </div>
  )
}
```

**Use it for**

- One short word on a card or a tab: New, Beta, Live.

**Not for**

- Counts or status that must be read at a glance: the text is moving.
- Several on one screen: the motion competes.

```bash
npx shadcn@latest add https://liquid-glass-interface.pages.dev/r/badge.json
```

## Usage

```tsx
import { GlassBadge } from '@/components/liquid-glass'

<div className="relative">
  <Card />
  <GlassBadge className="absolute -top-2 -right-2">New</GlassBadge>
</div>
```

## Behaviour

The text is drawn beneath the glass, so the rim bends the letters as they pass. Whatever sits behind the badge shows through, softly blurred. Hovering the badge's positioned parent speeds the flow up. Colour it with `bg-*` and `text-*`. With `tint` at 0.6 or below the glass counts as clear, and its rim mirrors the colours around it.

## Examples

### Your colours

```tsx
import { GlassBadge } from '@/components/liquid-glass'

const apps = [
  { name: 'Notes', tile: 'bg-[#ffd60a]', badge: 'bg-neutral-900 text-white', dot: '#ffd60a', label: 'Beta' },
  { name: 'Radio', tile: 'bg-[#ff375f]', badge: 'bg-white text-neutral-900', dot: '#ff375f', label: 'Live' },
  { name: 'Studio', tile: 'bg-[#0a84ff]', badge: 'bg-amber-400 text-neutral-900', dot: '#ffffff', label: 'Pro' },
]

// `bg-*` is the glass colour, `text-*` the flowing text, `dotColor` the separator.
// Each badge sits on the corner of its own tile, so each tile speeds up its own badge.
export default function Demo() {
  return (
    <div className="flex flex-wrap items-start justify-center gap-10">
      {apps.map((app) => (
        <div key={app.name} className="flex flex-col items-center gap-3">
          <div className={`relative size-28 rounded-[30px] ${app.tile}`}>
            <GlassBadge className={`absolute -top-2 -right-3 ${app.badge}`} dotColor={app.dot}>
              {app.label}
            </GlassBadge>
          </div>
          <p className="text-sm font-medium text-neutral-900 dark:text-white">{app.name}</p>
        </div>
      ))}
    </div>
  )
}
```

The badge takes its colour from its own classes: `bg-*` is the glass, `text-*` the text that flows through it, and `dotColor` the square between repeats. Hover speeds up only the badge whose positioned parent is under the pointer.

### A palette

```tsx
import { GlassBadge } from '@/components/liquid-glass'

const swatches = [
  { label: 'Open', badge: 'bg-emerald-600 text-white', dot: '#a7f3d0' },
  { label: 'Sale', badge: 'bg-rose-600 text-white', dot: '#fecdd3' },
  { label: 'Soon', badge: 'bg-amber-400 text-neutral-900', dot: '#78350f' },
  { label: 'Beta', badge: 'bg-sky-500 text-white', dot: '#e0f2fe' },
  { label: 'Pro', badge: 'bg-violet-600 text-white', dot: '#ddd6fe' },
  { label: 'New', badge: 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900', dot: '#f97316' },
]

// One badge, six colours: any `bg-*` with a `text-*` that reads on it, and a `dotColor`
// a shade away. Each cell is `relative`, so hovering a cell speeds up only its badge.
export default function Demo() {
  return (
    <div className="grid w-full max-w-md grid-cols-3 gap-2">
      {swatches.map((swatch) => (
        <div key={swatch.label} className="relative flex flex-col items-center gap-4 rounded-3xl bg-white px-4 py-7 dark:bg-neutral-800">
          <GlassBadge className={swatch.badge} dotColor={swatch.dot}>
            {swatch.label}
          </GlassBadge>
          <code className="text-xs text-neutral-500 dark:text-neutral-400">{swatch.badge.split(' ')[0]}</code>
        </div>
      ))}
    </div>
  )
}
```

Any `bg-*` works as the glass. Pair it with a `text-*` that reads on it (dark text on amber, white on the rest) and a `dotColor` a shade away from the text. They sit side by side here only to compare: in a product, keep to one badge per view.

### On a product, for a sale

```tsx
import { GlassBadge } from '@/components/liquid-glass'

// A rose badge on the corner of a product. Half of it hangs over the yellow cover and
// half over the page, so both show through the glass.
export default function Demo() {
  return (
    <div className="relative w-full max-w-xs">
      <div className="flex aspect-[4/3] items-center justify-center rounded-[28px] bg-[#ffd60a]">
        <span className="flex size-40 items-center justify-center rounded-full bg-neutral-900">
          <span className="flex size-14 items-center justify-center rounded-full bg-[#ff375f]">
            <span className="size-2 rounded-full bg-[#ffd60a]" />
          </span>
        </span>
      </div>
      <div className="mt-4 flex items-baseline justify-between gap-4 px-1">
        <p className="text-[17px] font-semibold tracking-tight text-neutral-900 dark:text-white">Night Drive LP</p>
        <p className="text-[15px] text-neutral-500 tabular-nums dark:text-neutral-400">
          <s>$26</s> <span className="font-semibold text-neutral-900 dark:text-white">$18</span>
        </p>
      </div>
      <GlassBadge className="absolute -top-2.5 -right-2.5 bg-rose-600" dotColor="#ffd60a">
        Sale
      </GlassBadge>
    </div>
  )
}
```

A rose badge hangs off the corner of the cover. Half of it is over the yellow and half over the page, so the glass shows both.

### On a dock item

```tsx
import { House, Library, Search, ShoppingBag } from 'lucide-react'

import { GlassBadge } from '@/components/liquid-glass'

const items = [
  { label: 'Home', icon: House, active: true },
  { label: 'Search', icon: Search },
  { label: 'Library', icon: Library },
  { label: 'Store', icon: ShoppingBag, badge: 'New' },
]

// An orange badge on one item of a dock. The button is `relative`: the badge hangs off
// its corner and speeds up when that button is hovered.
export default function Demo() {
  return (
    <nav aria-label="Dock" className="flex items-center gap-1.5 rounded-full bg-white p-2 dark:bg-neutral-800">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          aria-label={item.label}
          className={`relative flex size-14 items-center justify-center rounded-full ${
            item.active ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'text-neutral-500 dark:text-neutral-400'
          }`}
        >
          <item.icon className="size-6" />
          {item.badge && (
            <GlassBadge className="absolute -top-3 left-8 bg-orange-500" dotColor="#fff7ed">
              {item.badge}
            </GlassBadge>
          )}
        </button>
      ))}
    </nav>
  )
}
```

Put the badge inside the button and give the button `relative`: the orange badge then speeds up when that item is hovered, not the whole dock.

### Clearer glass over colour

```tsx
import { GlassBadge } from '@/components/liquid-glass'

const bands = ['bg-[#0a84ff]', 'bg-[#ff375f]', 'bg-[#ffd60a]', 'bg-[#30d158]']

// A lower `tint` lets more of the backdrop through: here the bands of the cover show in the
// glass. `speed` sets the pace at rest, and a wider badge (`w-24`) fits a longer word.
export default function Demo() {
  return (
    <div className="relative isolate w-full max-w-sm overflow-hidden rounded-[32px] p-7 pt-36">
      <div aria-hidden className="absolute inset-0 -z-10 flex">
        {bands.map((band) => (
          <span key={band} className={`flex-1 ${band}`} />
        ))}
      </div>
      <p className="text-2xl font-semibold tracking-tight text-white">Colour Fields</p>
      <p className="mt-1 text-[15px] text-white/80">Tonight, 21:00 · Hall B</p>
      <GlassBadge className="absolute top-5 left-5 w-24 bg-black text-white" tint={0.35} speed={0.25} dotColor="#ffd60a">
        Sold out
      </GlassBadge>
    </div>
  )
}
```

`tint` is how much of the badge colour covers what is behind it. At the default `0.82` the badge reads as a solid colour; lower it over a colourful backdrop and the backdrop shows in the glass, softly blurred. `speed` is the pace at rest, in loops per second. The badge is 64 px wide by default: widen it with a `w-*` class for a longer word.

### Inline, next to a label

```tsx
import { GlassBadge } from '@/components/liquid-glass'

const plans = [
  { name: 'Starter', price: '$0', note: 'One project, community support' },
  { name: 'Team', price: '$24', note: 'Unlimited projects, shared library', badge: 'Popular' },
  { name: 'Scale', price: '$96', note: 'Audit log, SSO and priority support' },
]

// Without a position class the badge flows inline, next to a label. One per list:
// it marks the single row worth a second look. Hover that row and the text speeds up.
export default function Demo() {
  return (
    <ul className="flex w-full max-w-md flex-col gap-2">
      {plans.map((plan) => (
        <li key={plan.name} className="relative flex items-center gap-4 rounded-2xl bg-white px-5 py-4 dark:bg-neutral-800">
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2.5">
              <span className="text-[17px] font-semibold tracking-tight text-neutral-900 dark:text-white">{plan.name}</span>
              {plan.badge && (
                <GlassBadge className="w-[72px] bg-violet-600" dotColor="#c4b5fd">
                  {plan.badge}
                </GlassBadge>
              )}
            </span>
            <span className="mt-0.5 block text-sm text-neutral-500 dark:text-neutral-400">{plan.note}</span>
          </span>
          <span className="text-xl font-semibold tracking-tight text-neutral-900 tabular-nums dark:text-white">{plan.price}</span>
        </li>
      ))}
    </ul>
  )
}
```

Without a position class the badge sits in the line like any inline element. Give the row `relative` so the hover that speeds the text up belongs to that row.

## API reference

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `string` | — | The text: one short word. |
| `dotColor` | `string` | `currentColor` | Separator colour between repeats. |
| `speed` | `number` | `0.4` | Loops per second at rest. |
| `tint` | `number` | `0.82` | Opacity of the badge colour over the backdrop. |
| `className` | `string` | — | Position and colour (`bg-*`, `text-*`). |

## Accessibility

- The text is announced once, not as a loop.
- With reduced motion the text stands still, centred.

Source: https://liquid-glass-interface.pages.dev/docs/badge

# GlassSlideToConfirm

> A slide-to-confirm track. Drag its glass thumb to the end to run one deliberate action; let go early and it springs back.

```tsx
import { GlassSlideToConfirm } from '@/components/liquid-glass'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Short and chunky: the `xl` track in a narrow width, with a one-word label.
export default function Demo() {
  return (
    <GlassSlideToConfirm className="max-w-64" size="xl" pendingLabel="Sending" successLabel="Sent" resetAfter={2600} onConfirm={() => wait(1400)}>
      Send
    </GlassSlideToConfirm>
  )
}
```

**Use it for**

- A routine action a stray tap must not trigger: send money, pay, unlock, start a shift.
- Phone-first surfaces, where a deliberate horizontal gesture replaces a confirm dialog.

**Not for**

- Easily undone actions: use GlassButton.
- An async action a single press may start: use GlassActionButton.
- Consequences people must read first: use a dialog.

```bash
npx shadcn@latest add https://liquid-glass-interface.pages.dev/r/slide-to-confirm.json
```

## Usage

```tsx
import { GlassSlideToConfirm } from '@/components/liquid-glass'

<GlassSlideToConfirm
  pendingLabel="Sending"
  successLabel="Sent"
  errorLabel="Not sent, slide to retry"
  onConfirm={send} // return the promise
>
  Slide to send $240
</GlassSlideToConfirm>
```

## The flow

- **Idle.** The thumb rests at the start as frosted white glass; the instruction is written in the track.
- **Drag.** The thumb turns to clear glass and bends the fill and the label it passes; its chevron stays in place, in the fill's text colour. It stays round while held, and speed stretches it along its travel. The fill trails a moment behind, joined to the thumb by a bridge that thins as they pull apart, and the track and the fill swell around the thumb like a membrane. Pushed past the end the track stretches like a rubber band; pushed against the start the wall gives a little. The thumb stays round at both.
- **Let go early.** Below `threshold` the thumb springs back; the fill's tail follows and is absorbed after it.
- **Pending.** Past the threshold the thumb lands at the end, the track draws in to a ring around it and `pendingLabel` appears beside it while a spinner takes the chevron's place, until the promise from `onConfirm` settles.
- **Success.** The white glass takes the fill's colour and the chevron's stroke bends into a check, beside `successLabel`. It stays confirmed, unless you set `resetAfter`: then the track opens first, `successLabel` leaving with its edge, and the thumb flies home after it, squashing a little as it lands against the start.
- **Error.** If `onConfirm` throws, the track opens again, the thumb returns and `errorLabel` replaces the instruction until the next slide.

## Examples

### A full-width payment

```tsx
import { GlassSlideToConfirm } from '@/components/liquid-glass'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Drag the thumb to the end: it turns to clear glass, pulls the fill behind it and bends
// the label it passes. Let go early and it springs back.
export default function Demo() {
  return (
    <div className="flex w-full max-w-sm flex-col items-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-neutral-900 text-[15px] font-semibold text-white dark:bg-white dark:text-neutral-900">BG</span>
      <p className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">Sending to Bilal Gürşen</p>
      <p className="mt-1 text-6xl font-semibold tracking-tight text-neutral-900 tabular-nums dark:text-white">$240</p>
      <GlassSlideToConfirm className="mt-9" size="lg" pendingLabel="Sending" successLabel="Sent to Bilal" resetAfter={2600} onConfirm={() => wait(1400)}>
        Slide to send
      </GlassSlideToConfirm>
    </div>
  )
}
```

### A coloured fill, and a failing action

```tsx
import { GlassSlideToConfirm } from '@/components/liquid-glass'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// `fillClassName` colours the fill. The second one always fails: a rejected promise
// springs the thumb back and writes `errorLabel` until the next slide.
export default function Demo() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-6">
      <GlassSlideToConfirm size="lg" fillClassName="bg-emerald-500 text-white" successLabel="Unlocked" resetAfter={2000} onConfirm={() => {}}>
        Slide to unlock
      </GlassSlideToConfirm>
      <GlassSlideToConfirm
        size="lg"
        fillClassName="bg-rose-500 text-white"
        pendingLabel="Deleting"
        errorLabel="Offline, slide to retry"
        onConfirm={async () => {
          await wait(1200)
          throw new Error('offline')
        }}
      >
        Slide to delete
      </GlassSlideToConfirm>
    </div>
  )
}
```

Colour the fill with `fillClassName`: its `bg-*` is the fill, its `text-*` is the label written on it, and the thumb's icon while the glass is clear. At rest the thumb is always frosted white glass with a dark icon (a flat white disc without WebGL2). The control fills its container, so set the width on a parent or with `className`.

## API reference

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `string` | — | The instruction in the track, and the slider's accessible name. |
| `onConfirm` | `() => unknown` | — | Required. Runs once the thumb reaches the end; return a promise to stay pending until it settles. |
| `onConfirmError` | `(error) => void` | — | Called when `onConfirm` throws; the thumb springs back. |
| `pendingLabel` | `string` | — | Written beside the spinner while `onConfirm` runs. |
| `successLabel` | `string` | — | Written beside the check after it succeeds. |
| `errorLabel` | `string` | — | Replaces the instruction after a failure, until the next slide. |
| `threshold` | `number` | `0.9` | Share of the track the thumb must pass before letting go confirms. |
| `resetAfter` | `number` | `0` | Milliseconds after a success before the track opens again. `0` stays confirmed. |
| `hint` | `boolean` | `true` | Nudges the thumb every few seconds until it has been touched. Off with reduced motion. |
| `icon` | `ReactNode` | `chevron` | The thumb's idle icon. |
| `size` | `'sm' \| 'md' \| 'lg' \| 'xl'` | `'md'` | Track height 40, 48, 56 or 96 px. |
| `fillClassName` | `string` | `'bg-[#3291FF] text-white'` | Classes of the fill: its colour and the colour of the text on it. |
| `disabled` | `boolean` | `false` | Dims the control and ignores pointer and keyboard. |
| `className` | `string` | — | Width and position of the track. |

## Accessibility

- A real `role="slider"` named by its label, with `aria-valuenow` kept in step with the thumb.
- Arrow keys move the thumb in tenths, Page Up and Page Down in quarters, Home returns it and End confirms. Holding Space or Enter glides it to the end; letting go early springs it back.
- A `role="status"` region announces the pending, success and error labels. While pending or confirmed the slider is `aria-disabled`.
- Success is never colour alone: the chevron becomes a check and the label is written beside it.
- Vertical page scroll still works over the control on touch. With reduced motion each state shows at once.

Source: https://liquid-glass-interface.pages.dev/docs/slide-to-confirm

# GlassCard

> A card made of frosted glass. Your content sits on it; its face blurs and tints whatever lies behind so the text stays readable, and its rim pulls it towards the centre.

```tsx
import { Cloud, Navigation } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'

import { GlassCard } from '@/components/liquid-glass'

// Two rows of colour slide behind two cards, and the rims bend them as they pass. The rows
// move, so the cards are `live`: they repaint what is behind them every frame.
const colours = ['#0a84ff', '#ff6b3d', '#30d158', '#ff375f', '#ffd60a', '#bf5af2']

function Row({ shift, seconds, reverse = false }: { shift: number; seconds: number; reverse?: boolean }) {
  const pills = [...colours, ...colours].map((_, i) => colours[(i + shift) % colours.length])
  return (
    // Two identical halves slide by exactly one half, on the kit's own marquee (it stops under reduced motion).
    <div
      data-glass-marquee
      className="flex w-max"
      style={{ '--glass-marquee-duration': `${seconds}s`, animationDirection: reverse ? 'reverse' : undefined } as CSSProperties}
    >
      {[0, 1].map((half) => (
        <div key={half} className="flex gap-3 pr-3">
          {pills.map((colour, i) => (
            <span key={i} className="h-12 w-24 shrink-0 rounded-full" style={{ background: colour }} />
          ))}
        </div>
      ))}
    </div>
  )
}

type ProgressiveBlurProps = {
  className?: string
  backgroundColor?: string
  position?: 'left' | 'right'
  width?: string
  blurAmount?: string
}

/** A progressive blur at one end of the rows: the stage colour over a backdrop blur, fading towards the middle. */
function ProgressiveBlur({
  className = '',
  backgroundColor = 'var(--stage, #ececee)',
  position = 'left',
  width = '150px',
  blurAmount = '4px',
}: ProgressiveBlurProps) {
  const isLeft = position === 'left'
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute top-0 h-full select-none ${className}`}
      style={{
        [isLeft ? 'left' : 'right']: 0,
        width,
        background: `linear-gradient(to ${isLeft ? 'left' : 'right'}, transparent, ${backgroundColor})`,
        maskImage: `linear-gradient(to ${isLeft ? 'right' : 'left'}, #000 50%, transparent)`,
        WebkitMaskImage: `linear-gradient(to ${isLeft ? 'right' : 'left'}, #000 50%, transparent)`,
        WebkitBackdropFilter: `blur(${blurAmount})`,
        backdropFilter: `blur(${blurAmount})`,
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}
    />
  )
}

/** Today, read after mount so a prerendered page doesn't freeze the day it was built. */
function useToday() {
  const [today, setToday] = useState<Date | null>(null)
  useEffect(() => setToday(new Date()), [])
  return today
}

export default function Demo() {
  const today = useToday()
  const events = [
    { title: 'Visit my GitHub', note: 'github.com/bilalgursen', href: 'https://github.com/bilalgursen', colour: '#0a84ff' },
    { title: 'Star liquid-glass', note: 'Leave a star on the repo', href: 'https://github.com/bilalgursen/liquid-glass', colour: '#ff6b3d' },
  ]
  return (
    // Where the two cards do not fit side by side (a phone), only the first one shows, centred on the two rows.
    <div className="@container relative flex w-full items-center justify-center gap-5 py-14">
      <div
        aria-hidden
        className="absolute inset-0 flex flex-col justify-center gap-3 overflow-hidden"
      >
        <Row shift={0} seconds={40} />
        <Row shift={3} seconds={48} reverse />
        <ProgressiveBlur position="left" />
        <ProgressiveBlur position="right" />
      </div>

      <GlassCard live className="flex size-44 flex-col justify-between p-4">
        <div>
          <p className="flex items-center gap-1 text-[13px] font-semibold">
            Istanbul
            <Navigation className="size-2.5 fill-current" />
          </p>
          <p className="mt-0.5 text-[44px] leading-none font-light tracking-[-0.04em]">16°</p>
        </div>
        <div className="text-[12px] leading-snug font-semibold">
          <Cloud className="mb-1 size-4 fill-current" />
          <p>Cloudy</p>
          <p className="opacity-60">H:19° L:15°</p>
        </div>
      </GlassCard>

      <GlassCard live className="hidden h-44 w-64 flex-col justify-between p-5 @min-[452px]:flex">
        <div className="flex items-baseline justify-between">
          <p className="text-[14px] font-semibold">{today ? today.toLocaleDateString(undefined, { weekday: 'long' }) : 'Today'}</p>
          <p className="text-[34px] leading-none font-semibold tracking-[-0.05em] tabular-nums">{today?.getDate()}</p>
        </div>
        <ul className="flex flex-col gap-2">
          {events.map((e) => (
            <li key={e.title}>
              <a href={e.href} target="_blank" rel="noreferrer" className="flex items-stretch gap-2.5 rounded-sm">
                <span className="w-1 shrink-0 rounded-full" style={{ background: e.colour }} />
                <span>
                  <span className="block text-[13px] leading-tight font-semibold">{e.title}</span>
                  <span className="block text-[11px] font-medium opacity-60">{e.note}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </GlassCard>
    </div>
  )
}
```

**Use it for**

- A small surface of content over colour, imagery or motion: a widget, a now-playing card, a summary.
- One or two cards, where what is behind them is part of the design.

**Not for**

- Long text and forms: the backdrop shows through. Use a plain card.
- A card on a flat background: there is nothing to bend.
- One clickable action: use GlassButton.

```bash
npx shadcn@latest add https://liquid-glass-interface.pages.dev/r/card.json
```

## Usage

```tsx
import { GlassCard } from '@/components/liquid-glass'

<GlassCard className="w-64 p-5">
  <p className="font-semibold">Wednesday</p>
  <p className="text-sm opacity-60">Design review · 10:00</p>
</GlassCard>

// Something moves behind it: repaint what it bends every frame.
<GlassCard live className="size-44 p-4">…</GlassCard>

// Clearer glass: no frost, less tint.
<GlassCard blur={0} tint={0.3} className="w-64 p-5">…</GlassCard>
```

## Examples

### Widgets over a wallpaper

```tsx
import { Flame, Headphones, Smartphone, Watch } from 'lucide-react'

import { GlassCard } from '@/components/liquid-glass'

// A home screen of widgets over a still wallpaper: bands of colour and three hard-edged discs,
// all plain CSS, and the rims bend them. Nothing moves behind the cards, so they need no
// `live`: like every glass in the kit, they repaint only when something changes, and stop
// drawing at rest.
const wallpaper = 'linear-gradient(155deg, #0a84ff 0 24%, #5e5ce6 24% 46%, #bf5af2 46% 66%, #ff375f 66% 84%, #ff9f0a 84%)'

/** A progress ring in plain CSS: a conic gradient with its middle masked out. */
function Ring({ value, colour }: { value: number; colour: string }) {
  const hole = 'radial-gradient(farthest-side, transparent calc(100% - 9px), #000 calc(100% - 8px))'
  return (
    <span
      role="img"
      aria-label={`${Math.round(value * 100)}%`}
      className="block aspect-square rounded-full"
      style={{
        background: `conic-gradient(${colour} ${value * 100}%, color-mix(in srgb, ${colour} 22%, transparent) 0)`,
        maskImage: hole,
        WebkitMaskImage: hole,
      }}
    />
  )
}

const move = { done: 420, goal: 600 }
const devices = [
  { name: 'Phone', level: 82, icon: Smartphone },
  { name: 'Earbuds', level: 64, icon: Headphones },
  { name: 'Watch', level: 18, icon: Watch },
]
const track = { title: 'Slow Liquid', artist: 'Glasswork', played: 0.38, elapsed: '1:12', left: '-2:04' }

export default function Demo() {
  return (
    <div className="relative flex w-full max-w-2xl justify-center overflow-hidden rounded-3xl px-3 py-10 sm:px-5 sm:py-16" style={{ background: wallpaper }}>
      <div aria-hidden className="absolute inset-0">
        <span className="absolute -top-10 left-[8%] size-40 rounded-full bg-[#ffd60a]" />
        <span className="absolute top-[38%] right-[6%] size-56 rounded-full bg-[#30d158]" />
        <span className="absolute -bottom-16 left-[22%] size-48 rounded-full bg-white" />
      </div>

      <div className="relative grid w-full max-w-[316px] grid-cols-2 gap-3 sm:max-w-[372px] sm:gap-5">
        {/* Activity: one ring, one number. */}
        <GlassCard className="flex aspect-square flex-col justify-between p-3 sm:p-4">
          <span className="relative w-12 sm:w-[72px]">
            <Ring value={move.done / move.goal} colour="#ff375f" />
            <Flame className="absolute inset-0 m-auto size-4 fill-current text-[#ff375f] sm:size-5" />
          </span>
          <div>
            <p className="text-[20px] leading-none font-semibold tracking-[-0.03em] tabular-nums sm:text-[26px]">
              {move.done}
              <span className="opacity-50">/{move.goal}</span>
            </p>
            <p className="mt-1 text-[10px] font-semibold tracking-wide whitespace-nowrap text-[#ff375f] uppercase sm:text-[11px]">Move · kcal</p>
          </div>
        </GlassCard>

        {/* Batteries: a level for each device. */}
        <GlassCard className="flex aspect-square flex-col justify-between p-3 sm:p-4">
          {devices.map(({ name, level, icon: Icon }) => (
            <div key={name}>
              <p className="flex items-center gap-1 text-[11px] leading-none font-semibold sm:gap-1.5 sm:text-[12px]">
                <Icon className="size-3.5 shrink-0" />
                <span className="flex-1">{name}</span>
                <span className="tabular-nums opacity-60">{level}%</span>
              </p>
              <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-current/15">
                <span className="block h-full rounded-full" style={{ width: `${level}%`, background: level > 20 ? '#30d158' : '#ff375f' }} />
              </span>
            </div>
          ))}
        </GlassCard>

        {/* Now playing: the cover, the track, and how far in. */}
        <GlassCard className="col-span-2 flex items-center gap-3.5 p-3.5 sm:gap-5 sm:p-5">
          <span
            aria-hidden
            className="size-[72px] shrink-0 rounded-2xl sm:size-[104px]"
            style={{ background: 'radial-gradient(circle at 30% 30%, #ffd60a 0 22%, transparent 23%), linear-gradient(135deg, #ff375f, #5e5ce6)' }}
          />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold tracking-wide uppercase opacity-60">Now playing</p>
            <p className="mt-1 truncate text-[17px] leading-tight font-semibold tracking-[-0.01em]">{track.title}</p>
            <p className="truncate text-[13px] font-medium opacity-60">{track.artist}</p>
            <span className="mt-3 block h-1 overflow-hidden rounded-full bg-current/15">
              <span className="block h-full rounded-full bg-current" style={{ width: `${track.played * 100}%` }} />
            </span>
            <p className="mt-1.5 flex justify-between text-[11px] font-medium tabular-nums opacity-60">
              <span>{track.elapsed}</span>
              <span>{track.left}</span>
            </p>
          </div>
        </GlassCard>
      </div>
    </div>
  )
}
```

Over a still backdrop, like the wallpaper here, the card needs no `live`. Like every glass in the kit it repaints only when something changes, and draws nothing at rest. Turn `live` on only when content moves behind the card, as with the rows of colour above: the card then draws every frame while it is on screen.

The rim pulls what is behind towards the card's centre, by 6.5% of the viewport, fading over half the card, so type and colour stretch along the edge. The face then frosts the bent picture with a 5 px blur (`blur`) and covers it with a tint (`tint`): 70% white on a light page, 70% black on a dark one. A 1.3 px white line runs inside the rim; there is no colour split or light, only a soft drop shadow. Unlike a button, the card stays still under the pointer: it holds content, it does not swell. Size and padding come from your classes, and the glass takes the card's corners: `rounded-[28px]` by default, any `rounded-*` class to change them. Text on clear glass follows the tone the glass ends up (`data-glass-tone`), so it reads on light and dark backdrops. For a coloured card, use `material="tinted"` with a `bg-*` class.

## API reference

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `ReactNode` | — | The card's content. |
| `material` | `'clear' \| 'tinted'` | `'clear'` | Clear bends what is behind; tinted uses the background colour. |
| `tint` | `number` | `0.7` | Clear glass only: how much tint covers the backdrop (0–1): white on a light page, black on a dark one. |
| `blur` | `number` | `5` | Clear glass only: how much the backdrop is frosted, in px like CSS `blur()`. `0` shows it sharp. |
| `live` | `boolean` | `false` | Repaint the backdrop every frame, for content that moves behind the card. |
| `className` | `string` | — | Size, padding, corners (`rounded-*`) and, for tinted glass, colour (`bg-*`). |
| `…rest` | `div attributes` | — | Passed to the `<div>` (`role`, `aria-label`, `onClick`…). |

## Accessibility

- A plain `<div>`: when the card stands for one thing, name it (`role="group"` with an `aria-label`).
- The glass canvas is `aria-hidden`; only your content is read.
- Content that moves behind it should respect reduced motion: the rows above stop.

Source: https://liquid-glass-interface.pages.dev/docs/card

# RangeSlider

> A range slider with a glass thumb: a small pill at rest that opens into a wide lens while you hold it.

```tsx
import { useState } from 'react'

import { RangeSlider } from '@/components/liquid-glass/controls/RangeSlider'

export default function Demo() {
  const [brightness, setBrightness] = useState(40)
  return (
    <div className="w-full max-w-sm">
      <RangeSlider label="Brightness" value={brightness} onChange={setBrightness} startIcon="moon" endIcon="sun" />
    </div>
  )
}
```

**Use it for**

- Picking a value on a continuous range: volume, brightness, opacity.

**Not for**

- Exact numbers the user must type: use a number input.
- Confirming one action: that is Slide to Confirm.

```bash
npx shadcn@latest add https://liquid-glass-interface.pages.dev/r/slider.json
```

> Slider, Switch and Checkbox are drawn by their own renderer, which needs `three`, and take their behaviour (keyboard, the label, the input a form reads) from UI SDK: `@ui-sdk/core` and `@ui-sdk/react`. The install command adds all three; UI SDK is in beta, so it is added at the exact version this was built on.

## Usage

```tsx
import { RangeSlider } from '@/components/liquid-glass/controls/RangeSlider'

const [volume, setVolume] = useState(60)

<RangeSlider label="Volume" value={volume} onChange={setVolume} />
```

Drag the glass, or press the track to bring it there. While held, the pill swells into a clear lens that bends the track and the fill beneath it, and squashes and stretches with its speed; released, it springs back to the small pill.

## Examples

### Colours

```tsx
import { RangeSlider } from '@/components/liquid-glass/controls/RangeSlider'

// `color` is the filled part of the track. Without it the slider is the kit's blue.
export default function Demo() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-8">
      <RangeSlider label="Blue" value={30} />
      <RangeSlider label="Green" color="#34c759" value={45} />
      <RangeSlider label="Orange" color="#ff9500" value={60} />
      <RangeSlider label="Pink" color="#ff2d55" value={75} />
    </div>
  )
}
```

`color` is the filled part of the track; without it the slider is the kit's blue. The thumb stays white at rest and clear glass while held.

## API reference

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `number` | `50` | Current value. |
| `onChange` | `(value: number) => void` | — | Called with the new value. |
| `min / max / step` | `number` | `0 / 100 / 1` | The range and its step. |
| `label` | `string` | `'Volume'` | Label above the track; an empty string hides it. |
| `name` | `string` | — | Submits the value under this name with the form around it. |
| `showValue` | `boolean` | `true` | Shows the value next to the label. |
| `size` | `'sm' \| 'md' \| 'lg' \| 'xl'` | `'md'` | Track height 8, 12, 18 or 26 px; the glass scales with it. |
| `startIcon / endIcon` | `IconName \| 'none'` | `'none'` | Icons at either end of the track. |
| `color` | `string` | `'#3291FF'` | The filled part of the track: a hex, `rgb()` or named colour, not a CSS variable. |
| `theme` | `'light' \| 'dark'` | — | Overrides the page theme for this slider. |
| `restFrost` | `number` | `1` | The thumb at rest: 1 = a white pill, 0 = clear glass. Held, it is always clear glass. |
| `refraction` | `number` | `37` | How far the lens bends what lies beneath. |
| `dispersion / rimIntensity / magnification` | `number` | `0.12 / 0.55 / 0` | Colour fringing, rim light and zoom of the lens. |
| `motionStretch / motionSmoothing` | `number` | `3 / 30` | Squash and stretch with speed; how tightly the glass follows. |
| `pressSpeed / pressBounce` | `number` | `16 / 0.4` | The spring that opens and closes the lens. |

## Accessibility

- A native range input does the work: arrow keys, Home, End and Page Up / Down, and screen readers announce the value.
- The `label` names the input.
- With reduced motion the glass follows without springs.

Source: https://liquid-glass-interface.pages.dev/docs/slider

# Switch

> An on/off toggle whose knob swells into a clear lens while it crosses the track.

```tsx
import { useState } from 'react'

import { Switch } from '@/components/liquid-glass/controls/Switch'

export default function Demo() {
  const [on, setOn] = useState(true)
  return <Switch label="Notifications" description="Banners and sounds" checked={on} onChange={setOn} />
}
```

**Use it for**

- A setting that takes effect at once: Wi-Fi, notifications, dark mode.

**Not for**

- A choice that is saved later with a form: use Checkbox.
- More than two states: use Tabs.

```bash
npx shadcn@latest add https://liquid-glass-interface.pages.dev/r/switch.json
```

## Usage

```tsx
import { Switch } from '@/components/liquid-glass/controls/Switch'

const [on, setOn] = useState(false)

<Switch label="Notifications" description="Banners and sounds" checked={on} onChange={setOn} />
```

Tap to flip, or hold the knob and drag it across. Needs `three` and UI SDK, like Slider.

## Examples

### Colours

```tsx
import { Switch } from '@/components/liquid-glass/controls/Switch'

// `color` is the track while on. Without it the switch is the kit's blue.
export default function Demo() {
  return (
    <div className="flex flex-col gap-5">
      <Switch label="Blue" checked />
      <Switch label="Green" color="#34c759" checked />
      <Switch label="Orange" color="#ff9500" checked />
      <Switch label="Pink" color="#ff2d55" checked />
    </div>
  )
}
```

`color` is the track while on; without it the switch is the kit's blue. The knob stays white. Without `onChange` a switch keeps its own state, starting from `checked`.

## API reference

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `checked` | `boolean` | `false` | On or off. |
| `onChange` | `(checked: boolean) => void` | — | Called with the new state. |
| `label` | `string` | `'Notifications'` | Text beside the switch; an empty string leaves the switch alone. |
| `description` | `string` | — | A second, quieter line under the label. |
| `name` | `string` | — | Submits with the form around it under this name. |
| `labelSide` | `'left' \| 'right'` | `'right'` | Which side the label sits on. |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Track height 22, 28 or 36 px. |
| `color` | `string` | `'#3291FF'` | The track while on: a hex, `rgb()` or named colour, not a CSS variable. |
| `theme` | `'light' \| 'dark'` | — | Overrides the page theme for this switch. |
| `disabled` | `boolean` | `false` | Dimmed and not interactive. |
| `lensScale` | `number` | `1.55` | Size of the travelling lens relative to the resting knob. |
| `refraction / knobBounce` | `number` | `26 / 0.3` | How far the lens bends the track; how much the knob overshoots. |

## Accessibility

- A `<button role="switch">` with `aria-checked`: Space and Enter flip it.
- The `label` is a real `<label>` tied to the button.
- With reduced motion the knob simply jumps.

Source: https://liquid-glass-interface.pages.dev/docs/switch

# Checkbox

> A checkbox under a cap of clear glass: the box and its mark are always seen through the lens.

```tsx
import { useState } from 'react'

import { Checkbox } from '@/components/liquid-glass/controls/Checkbox'

export default function Demo() {
  const [remember, setRemember] = useState(true)
  return (
    <div className="flex flex-col gap-4">
      <Checkbox label="Remember this device" checked={remember} onChange={setRemember} />
      <Checkbox label="Circle" shape="circle" checked={false} />
    </div>
  )
}
```

**Use it for**

- Choosing any number of items in a list or a form.
- Agreeing to something that is submitted later.

**Not for**

- A setting that takes effect at once: use Switch.
- One choice out of several: use Tabs.

```bash
npx shadcn@latest add https://liquid-glass-interface.pages.dev/r/checkbox.json
```

## Usage

```tsx
import { Checkbox } from '@/components/liquid-glass/controls/Checkbox'

const [remember, setRemember] = useState(true)

<Checkbox label="Remember this device" checked={remember} onChange={setRemember} />
```

The glass cap is there at rest, not only while pressed. Needs `three` and UI SDK, like Slider.

## Examples

### Colours

```tsx
import { Checkbox } from '@/components/liquid-glass/controls/Checkbox'

// `color` is the box while checked. Without it the checkbox is the kit's blue.
export default function Demo() {
  return (
    <div className="flex flex-col gap-5">
      <Checkbox label="Blue" />
      <Checkbox label="Green" color="#34c759" />
      <Checkbox label="Orange" color="#ff9500" />
      <Checkbox label="Pink" color="#ff2d55" />
    </div>
  )
}
```

`color` is the box while checked; without it the checkbox is the kit's blue. The mark stays white.

## API reference

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `checked` | `boolean` | `true` | Checked or not. |
| `onChange` | `(checked: boolean) => void` | — | Called with the new state. |
| `label` | `string` | `'Remember this device'` | Text beside the box; an empty string leaves the box alone. |
| `description` | `string` | — | A second, quieter line under the label. |
| `name` | `string` | — | Submits with the form around it under this name. |
| `shape` | `'rounded' \| 'circle'` | `'rounded'` | A rounded square or a circle. |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Box size 18, 22 or 28 px. |
| `color` | `string` | `'#3291FF'` | The box while checked: a hex, `rgb()` or named colour, not a CSS variable. |
| `theme` | `'light' \| 'dark'` | — | Overrides the page theme for this checkbox. |
| `disabled` | `boolean` | `false` | Dimmed and not interactive. |
| `swell` | `number` | `1.18` | How much the cap grows while pressed. |

## Accessibility

- A `<button role="checkbox">` with `aria-checked`: Space toggles it.
- The `label` is a real `<label>` tied to the button.
- With reduced motion the mark and the cap change without springs.

Source: https://liquid-glass-interface.pages.dev/docs/checkbox

# GlassSelect

> A select whose list swells out of its button as one body of glass, holds on by a neck that stretches and snaps, and closes by the same motion played backwards.

```tsx
import { useState } from 'react'

import { GlassSelect } from '@/components/liquid-glass/glass-select'

const options = [
  { value: 'standard', label: 'Standard' },
  { value: 'express', label: 'Express' },
  { value: 'same-day', label: 'Same day' },
  { value: 'pickup', label: 'Pickup (closed today)', disabled: true },
]

const COLS = 13
const ROWS = 7

/** 1 around the middle of the grid, falling to 0 at its edge. */
const fade = (col: number, row: number) => {
  const distance = Math.hypot((col - (COLS - 1) / 2) / (COLS / 2), (row - (ROWS - 1) / 2) / (ROWS / 2))
  return Math.min(1, Math.max(0, (1 - distance) / 0.45))
}

// Open it: the list swells out of the whole button, a neck stretches between them and snaps,
// and the options arrive one by one. Close it and the same motion plays backwards.
// Behind it, only a fine grid on the page's own colour, centred on the button (which sits
// 14px below the middle, under its label).
// The grid is plain DOM: every cell draws its own top and left line, fainter towards the edge.
export default function Demo() {
  const [value, setValue] = useState<string | null>(null)
  return (
    <div className="relative isolate flex h-96 w-full max-w-xl items-center justify-center">
      <div aria-hidden className="absolute top-[calc(50%+14px)] left-1/2 -z-10 grid -translate-x-1/2 -translate-y-1/2 grid-cols-[repeat(13,40px)]">
        {Array.from({ length: COLS * ROWS }, (_, i) => (
          <span key={i} className="relative size-10" style={{ opacity: fade(i % COLS, Math.floor(i / COLS)) }}>
            <span className="absolute inset-x-0 top-0 h-px bg-black/10 dark:bg-white/10" />
            <span className="absolute inset-y-0 left-0 w-px bg-black/10 dark:bg-white/10" />
          </span>
        ))}
      </div>
      <GlassSelect label="Delivery" placeholder="Choose a speed" options={options} value={value} onValueChange={setValue} />
    </div>
  )
}
```

**Use it for**

- Picking one option from a short list that should stay out of the way until asked for.
- A form field: the value is submitted under `name`.

**Not for**

- Two to five options that fit on one line: use Tabs.
- An on/off setting: use Switch.
- Several of these on one screen: one stretching list is a moment, a form full of them is noise.

```bash
npx shadcn@latest add https://liquid-glass-interface.pages.dev/r/select.json
```

> The behaviour (keyboard, typeahead, focus, positioning, ARIA) comes from UI SDK, so Select needs `@ui-sdk/core` and `@ui-sdk/react`. The install command adds them at the exact version this was built on: UI SDK is in beta and its API may still change.

## Usage

```tsx
import { GlassSelect } from '@/components/liquid-glass/glass-select'

const [speed, setSpeed] = useState<string | null>(null)

<GlassSelect
  label="Delivery"
  placeholder="Choose a speed"
  value={speed}
  onValueChange={setSpeed}
  options={[
    { value: 'standard', label: 'Standard' },
    { value: 'express', label: 'Express' },
    { value: 'pickup', label: 'Pickup', disabled: true },
  ]}
/>
```

Opening, the list swells out of the whole button, the neck between them stretches and snaps, both halves take the jolt and the options arrive one after another. Closing is the opening played backwards, frame for frame; reopen it on the way and it carries on from there. The button wears Button's glass, with its light and shadow. Once the neck lets go, the list settles into Card's frost with no light of its own: a thin line draws its edge and a soft shadow lifts it off the page. The glass is clear, so it needs something behind it to bend.

## Your own popup

The stretch is not tied to a select. `GlassPopup`, which ships with it, puts the same motion on any control and the surface it opens (a menu, a popover):

```tsx
import { GlassPopupAnchor, GlassPopupSurface, useGlassPopup } from '@/components/liquid-glass'

const popup = useGlassPopup()

<MenuTrigger data-glass-host className="rounded-full px-5 h-12 bg-white/60 dark:bg-white/10">
  <GlassPopupAnchor popup={popup} />
  Options
</MenuTrigger>
<MenuContent data-glass-popup data-glass-skip sideOffset={12} className="rounded-3xl p-1.5">
  <GlassPopupSurface popup={popup} />
  <div role="menu">
    <MenuItem style={{ '--glass-i': 0 }}>Rename</MenuItem>
    <MenuItem style={{ '--glass-i': 1 }}>Duplicate</MenuItem>
  </div>
</MenuContent>
```

- `GlassPopupAnchor` is the first child of the control (marked `data-glass-host`); `GlassPopupSurface` is the first child of the content (marked `data-glass-popup`).
- The content carries `data-open` while open and `data-ending-style` while it closes, and stays mounted until its animations finish: UI SDK's popups do this.
- Items are `role="option"`, `role="menuitem"` or `data-glass-item`; `--glass-i` is each one's place in the queue.
- The surface takes its corners from the content's own `rounded-*` class; leave about 12 px between it and the control for the neck.

## API reference

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `label` | `ReactNode` | — | The field's label, tied to the button. |
| `options` | `{ value: string; label: ReactNode; disabled?: boolean }[]` | — | The choices, in order. |
| `value` | `string \| null` | — | The selected value (controlled). `null` = nothing selected. |
| `defaultValue` | `string \| null` | — | The starting value when the select keeps its own state. |
| `onValueChange` | `(value: string \| null) => void` | — | Called with the new value. |
| `placeholder` | `string` | — | Shown on the button while nothing is selected. |
| `name` | `string` | — | Submits the value with a form under this name. |
| `disabled` | `boolean` | `false` | Dimmed and not interactive. |
| `className` | `string` | — | Classes for the field (label and button); it is 16rem wide by default. |
| `useGlassPopup({ matchWidth })` | `boolean` | `false` | Your own popup: keep the surface exactly as wide as its control. |

## Accessibility

- A `combobox` button that opens a `listbox` (the WAI-ARIA select pattern), labelled by `label`.
- Arrow keys, Home and End move through the options, typing a letter jumps to a match, Enter selects, Escape closes and returns focus to the button. Disabled options are skipped.
- With reduced motion the list opens and closes at once, with no stretch or jolt.
- Without WebGL2 it is a plain frosted list.

Source: https://liquid-glass-interface.pages.dev/docs/select

# GlassButtonGroup

> Related actions in one body of glass. The buttons share a single lens: point at any of them and the whole body swells.

```tsx
import { Archive, ArrowLeft, BellOff, Clock, Ellipsis, Flag, MailOpen, Tag, Trash2 } from 'lucide-react'

import { GlassButtonGroup, GlassButtonGroupItem } from '@/components/liquid-glass'
import {
  GlassDropdownMenu,
  GlassDropdownMenuContent,
  GlassDropdownMenuItem,
  GlassDropdownMenuSeparator,
  GlassDropdownMenuTrigger,
} from '@/components/liquid-glass/glass-dropdown-menu'

const COLS = 13
const ROWS = 7

/** 1 around the middle of the grid, falling to 0 at its edge. */
const fade = (col: number, row: number) => {
  const distance = Math.hypot((col - (COLS - 1) / 2) / (COLS / 2), (row - (ROWS - 1) / 2) / (ROWS / 2))
  return Math.min(1, Math.max(0, (1 - distance) / 0.45))
}

// The actions of a message. Some share a body of glass, some stand apart: nested groups, with
// the outer one only spacing them. The glass is white unless a group brings its own colour,
// as the back button does. Snooze stands apart in clear glass (`material="clear"`): it bends the
// grid, and its rim mirrors the white glass beside it. The three dots stand apart and open a
// menu that stretches out of them.
// Where the row would not fit (a phone), the labels step aside and the icons carry it.
// Point at a body and it swells; press and it grows. Behind them, the Press demo's fine grid
// on the page's own colour, centred on the glass: plain DOM, every cell draws its own top
// and left line, fainter towards the edge.
export default function Demo() {
  return (
    <div className="@container relative isolate flex h-72 w-full max-w-xl items-center justify-center">
      <div aria-hidden className="absolute top-1/2 left-1/2 -z-10 grid -translate-x-1/2 -translate-y-1/2 grid-cols-[repeat(13,40px)]">
        {Array.from({ length: COLS * ROWS }, (_, i) => (
          <span key={i} className="relative size-10" style={{ opacity: fade(i % COLS, Math.floor(i / COLS)) }}>
            <span className="absolute inset-x-0 top-0 h-px bg-black/10 dark:bg-white/10" />
            <span className="absolute inset-y-0 left-0 w-px bg-black/10 dark:bg-white/10" />
          </span>
        ))}
      </div>
      <GlassButtonGroup aria-label="Message">
        <GlassButtonGroup className="bg-neutral-900 text-white">
          <GlassButtonGroupItem aria-label="Back" className="px-0">
            <ArrowLeft />
          </GlassButtonGroupItem>
        </GlassButtonGroup>
        <GlassButtonGroup>
          <GlassButtonGroupItem className="@max-[440px]:px-0">
            <Archive />
            <span className="@max-[440px]:sr-only">Archive</span>
          </GlassButtonGroupItem>
          <GlassButtonGroupItem className="@max-[440px]:px-0">
            <Flag />
            <span className="@max-[440px]:sr-only">Report</span>
          </GlassButtonGroupItem>
        </GlassButtonGroup>
        <GlassButtonGroup material="clear">
          <GlassButtonGroupItem className="@max-[440px]:px-0">
            <Clock />
            <span className="@max-[440px]:sr-only">Snooze</span>
          </GlassButtonGroupItem>
        </GlassButtonGroup>
        <GlassDropdownMenu>
          <GlassButtonGroup>
            <GlassDropdownMenuTrigger asChild>
              <GlassButtonGroupItem aria-label="More" className="px-0">
                <Ellipsis />
              </GlassButtonGroupItem>
            </GlassDropdownMenuTrigger>
          </GlassButtonGroup>
          <GlassDropdownMenuContent>
            <GlassDropdownMenuItem>
              <MailOpen />
              Mark as read
            </GlassDropdownMenuItem>
            <GlassDropdownMenuItem>
              <Tag />
              Add label
            </GlassDropdownMenuItem>
            <GlassDropdownMenuItem>
              <BellOff />
              Mute thread
            </GlassDropdownMenuItem>
            <GlassDropdownMenuSeparator />
            <GlassDropdownMenuItem destructive>
              <Trash2 />
              Delete
            </GlassDropdownMenuItem>
          </GlassDropdownMenuContent>
        </GlassDropdownMenu>
      </GlassButtonGroup>
    </div>
  )
}
```

**Use it for**

- Two to five actions on the same thing: a message toolbar, map controls, a split button.
- A main action with its options next to it, divided by a separator.

**Not for**

- Choosing between options, where one stays selected: use Tabs.
- A single action: use Button.
- Unrelated actions: one body says they belong together.

```bash
npx shadcn@latest add https://liquid-glass-interface.pages.dev/r/button-group.json
```

## Usage

```tsx
import {
  GlassButtonGroup,
  GlassButtonGroupItem,
  GlassButtonGroupSeparator,
  GlassButtonGroupText,
} from '@/components/liquid-glass'

<GlassButtonGroup aria-label="Message">
  <GlassButtonGroupItem onClick={archive}>Archive</GlassButtonGroupItem>
  <GlassButtonGroupItem onClick={report}>Report</GlassButtonGroupItem>
  <GlassButtonGroupSeparator />
  <GlassButtonGroupItem aria-label="More"><Ellipsis /></GlassButtonGroupItem>
</GlassButtonGroup>
```

The group is the glass, and the glass is Button's, with its light and shadow. It is tinted white, on light and dark pages alike, unless you colour it. Its items are plain buttons lying in it, with no glass of their own. Do not put a Button inside: a lens within a lens bends nothing. The items get no background of their own under the pointer: the glass answers for the whole group.

## Together and apart

Nest groups to keep some actions in one body and others on their own. The outer group draws no glass: it only lays the inner ones out with space between them, and a group with a single item is a button standing apart.

```tsx
<GlassButtonGroup aria-label="Message">
  <GlassButtonGroup>
    <GlassButtonGroupItem aria-label="Back" className="px-0"><ArrowLeft /></GlassButtonGroupItem>
  </GlassButtonGroup>
  <GlassButtonGroup>
    <GlassButtonGroupItem>Archive</GlassButtonGroupItem>
    <GlassButtonGroupItem>Report</GlassButtonGroupItem>
  </GlassButtonGroup>
</GlassButtonGroup>
```

## With a menu

For the actions that do not fit, wrap one group in a Dropdown Menu and put its trigger on the three dots: the list stretches out of the whole group, as Select's does out of its button. See Dropdown Menu.

## Examples

### Tinted, split, text and sizes

```tsx
import { ChevronDown, Copy, GitBranch } from 'lucide-react'

import { GlassButtonGroup, GlassButtonGroupItem, GlassButtonGroupSeparator, GlassButtonGroupText } from '@/components/liquid-glass'

// The glass takes the group's own background class. Top: a split button, the main action
// and its options in one body. Bottom: text that is not a button, and the three sizes.
export default function Demo() {
  return (
    <div className="flex flex-col items-center gap-10">
      <div className="flex flex-wrap items-center justify-center gap-4">
        <GlassButtonGroup size="lg" className="bg-blue-600 text-white">
          <GlassButtonGroupItem>Follow</GlassButtonGroupItem>
          <GlassButtonGroupSeparator />
          <GlassButtonGroupItem aria-label="Follow options">
            <ChevronDown />
          </GlassButtonGroupItem>
        </GlassButtonGroup>
        <GlassButtonGroup size="lg" className="bg-neutral-900 text-white dark:bg-white dark:text-neutral-900">
          <GlassButtonGroupText>
            <GitBranch />
            main
          </GlassButtonGroupText>
          <GlassButtonGroupSeparator />
          <GlassButtonGroupItem>
            <Copy />
            Copy
          </GlassButtonGroupItem>
        </GlassButtonGroup>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-4">
        {(['sm', 'md', 'lg'] as const).map((size) => (
          <GlassButtonGroup key={size} size={size} className="bg-emerald-600 text-white">
            <GlassButtonGroupItem>Cut</GlassButtonGroupItem>
            <GlassButtonGroupItem>Copy</GlassButtonGroupItem>
            <GlassButtonGroupItem>Paste</GlassButtonGroupItem>
          </GlassButtonGroup>
        ))}
      </div>
    </div>
  )
}
```

Colour the glass with a normal class on the group, such as `bg-blue-600 text-white`; `material="clear"` makes it clear glass that bends the page. A separator between a main action and a small second item makes a split button. `GlassButtonGroupText` is text that is not a button: a unit, a branch name, a count.

### Vertical

```tsx
import { LocateFixed, Minus, Plus } from 'lucide-react'
import { useState } from 'react'

import { GlassButtonGroup, GlassButtonGroupItem, GlassButtonGroupSeparator } from '@/components/liquid-glass'

// `orientation="vertical"` stacks the items, and the separators turn with them. Here it is
// the zoom control of a map drawn in flat colour: blocks, a park, water and two roads.
export default function Demo() {
  const [zoom, setZoom] = useState(3)
  return (
    <div className="relative isolate flex h-80 w-full max-w-xl items-center justify-end overflow-hidden rounded-3xl bg-stone-200 pr-8 dark:bg-stone-800">
      <div aria-hidden className="absolute inset-0 -z-10">
        <span className="absolute top-0 right-0 h-28 w-56 bg-sky-400 dark:bg-sky-700" />
        <span className="absolute right-24 bottom-0 h-36 w-40 bg-emerald-400 dark:bg-emerald-700" />
        <span className="absolute top-8 left-8 h-24 w-40 rounded-xl bg-stone-300 dark:bg-stone-700" />
        <span className="absolute bottom-8 left-8 h-28 w-28 rounded-xl bg-stone-300 dark:bg-stone-700" />
        <span className="absolute bottom-8 left-44 h-28 w-24 rounded-xl bg-amber-300 dark:bg-amber-600" />
        <span className="absolute inset-x-0 top-36 h-5 bg-white dark:bg-stone-600" />
        <span className="absolute inset-y-0 right-16 w-5 bg-white dark:bg-stone-600" />
        <span className="absolute top-12 left-12 text-sm font-semibold text-stone-500 dark:text-stone-400">Zoom {zoom}</span>
      </div>
      <GlassButtonGroup aria-label="Map" orientation="vertical" size="lg">
        <GlassButtonGroupItem aria-label="Zoom in" disabled={zoom === 5} onClick={() => setZoom(zoom + 1)} className="px-0">
          <Plus />
        </GlassButtonGroupItem>
        <GlassButtonGroupItem aria-label="Zoom out" disabled={zoom === 1} onClick={() => setZoom(zoom - 1)} className="px-0">
          <Minus />
        </GlassButtonGroupItem>
        <GlassButtonGroupSeparator />
        <GlassButtonGroupItem aria-label="My location" className="px-0">
          <LocateFixed />
        </GlassButtonGroupItem>
      </GlassButtonGroup>
    </div>
  )
}
```

`orientation="vertical"` stacks the items; the separators turn with them and the body takes corners that sit concentric with its items. For icon-only items, add `px-0` to keep them square and give each an `aria-label`.

## API reference

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `orientation` | `'horizontal' \| 'vertical'` | `'horizontal'` | Side by side or stacked. |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Height of a horizontal group: 32, 40 or 48 px. The items follow. |
| `material` | `'tinted' \| 'clear'` | `'tinted'` | Tinted is white, or the colour of your own `bg-*` class; clear bends the page. |
| `tint` | `number` | `0.6` | Clear glass only: how much tint covers the backdrop (0–1). |
| `…rest` | `div attributes` | — | Passed to the group (`aria-label`, `className`…). |
| `GlassButtonGroupItem asChild` | `boolean` | `false` | Render the item on its single child element (a router `<Link>`, a menu trigger) instead of a `<button>`. Otherwise it takes button attributes (`onClick`, `disabled`…). |
| `GlassButtonGroupSeparator` | `className` | — | A hairline between two items. It turns with the group. |
| `GlassButtonGroupText` | `span attributes` | — | Text that is not a button. |

## Accessibility

- The group has `role="group"`: name it with `aria-label` or `aria-labelledby`.
- Every item is a real `<button>`; Tab moves through them one by one, Enter and Space press.
- Icon-only items need an `aria-label`. Separators are `role="separator"`.
- Without WebGL2 it keeps its plain CSS colour.

Source: https://liquid-glass-interface.pages.dev/docs/button-group

# GlassDropdownMenu

> A menu of actions that swells out of the control that opens it as one body of glass: a button of its own, or a whole Button Group.

```tsx
import { ChevronDown, Copy, Pencil, Share2, Trash2 } from 'lucide-react'

import {
  GlassDropdownMenu,
  GlassDropdownMenuContent,
  GlassDropdownMenuItem,
  GlassDropdownMenuSeparator,
  GlassDropdownMenuTrigger,
} from '@/components/liquid-glass/glass-dropdown-menu'

const COLS = 13
const ROWS = 7

/** 1 around the middle of the grid, falling to 0 at its edge. */
const fade = (col: number, row: number) => {
  const distance = Math.hypot((col - (COLS - 1) / 2) / (COLS / 2), (row - (ROWS - 1) / 2) / (ROWS / 2))
  return Math.min(1, Math.max(0, (1 - distance) / 0.45))
}

// Open it: the list swells out of the whole button, a neck stretches between them and snaps,
// and the actions arrive one by one. Close it and the same motion plays backwards.
// Behind it, only the Press demo's fine grid on the page's own colour, centred on the button:
// plain DOM, every cell draws its own top and left line, fainter towards the edge.
export default function Demo() {
  return (
    <div className="relative isolate flex h-96 w-full max-w-xl items-center justify-center">
      <div aria-hidden className="absolute top-1/2 left-1/2 -z-10 grid -translate-x-1/2 -translate-y-1/2 grid-cols-[repeat(13,40px)]">
        {Array.from({ length: COLS * ROWS }, (_, i) => (
          <span key={i} className="relative size-10" style={{ opacity: fade(i % COLS, Math.floor(i / COLS)) }}>
            <span className="absolute inset-x-0 top-0 h-px bg-black/10 dark:bg-white/10" />
            <span className="absolute inset-y-0 left-0 w-px bg-black/10 dark:bg-white/10" />
          </span>
        ))}
      </div>
      <GlassDropdownMenu>
        <GlassDropdownMenuTrigger className="h-12 px-6 text-[15px]">
          Options
          <ChevronDown className="opacity-60" />
        </GlassDropdownMenuTrigger>
        <GlassDropdownMenuContent>
          <GlassDropdownMenuItem>
            <Pencil />
            Rename
          </GlassDropdownMenuItem>
          <GlassDropdownMenuItem>
            <Copy />
            Duplicate
          </GlassDropdownMenuItem>
          <GlassDropdownMenuItem>
            <Share2 />
            Share
          </GlassDropdownMenuItem>
          <GlassDropdownMenuSeparator />
          <GlassDropdownMenuItem destructive>
            <Trash2 />
            Delete
          </GlassDropdownMenuItem>
        </GlassDropdownMenuContent>
      </GlassDropdownMenu>
    </div>
  )
}
```

**Use it for**

- A handful of actions on one thing, kept out of the way until asked for: Rename, Duplicate, Delete.
- The overflow of a Button Group: the three dots at its end.

**Not for**

- Picking a value that stays selected: use Select.
- Two or three actions that fit on screen: show them in a Button Group.
- Several of these on one screen: one stretching list is a moment, many are noise.

```bash
npx shadcn@latest add https://liquid-glass-interface.pages.dev/r/dropdown-menu.json
```

> The behaviour (keyboard, typeahead, focus, positioning, ARIA) comes from UI SDK, so Dropdown Menu needs `@ui-sdk/core` and `@ui-sdk/react`. The install command adds them at the exact version this was built on: UI SDK is in beta and its API may still change.

## Usage

```tsx
import {
  GlassDropdownMenu,
  GlassDropdownMenuContent,
  GlassDropdownMenuItem,
  GlassDropdownMenuSeparator,
  GlassDropdownMenuTrigger,
} from '@/components/liquid-glass/glass-dropdown-menu'

<GlassDropdownMenu>
  <GlassDropdownMenuTrigger>Options</GlassDropdownMenuTrigger>
  <GlassDropdownMenuContent>
    <GlassDropdownMenuItem onSelect={rename}>Rename</GlassDropdownMenuItem>
    <GlassDropdownMenuItem onSelect={duplicate}>Duplicate</GlassDropdownMenuItem>
    <GlassDropdownMenuSeparator />
    <GlassDropdownMenuItem destructive onSelect={remove}>Delete</GlassDropdownMenuItem>
  </GlassDropdownMenuContent>
</GlassDropdownMenu>
```

It is Select's motion on a list of actions: the list swells out of the whole trigger, the neck between them stretches and snaps, and the items arrive one after another; closing plays it backwards. The trigger wears Button's clear glass, so it needs something behind it to bend.

## Out of a Button Group

Wrap one group and the content in the menu, and put the trigger on one of the group's items with `asChild`. The whole group is then the anchor: the list swells out of its body and takes its colour, white included. Wrap only the group that opens the menu.

```tsx
<GlassDropdownMenu>
  <GlassButtonGroup>
    <GlassDropdownMenuTrigger asChild>
      <GlassButtonGroupItem aria-label="More" className="px-0"><Ellipsis /></GlassButtonGroupItem>
    </GlassDropdownMenuTrigger>
  </GlassButtonGroup>
  <GlassDropdownMenuContent>
    <GlassDropdownMenuItem>Mark as read</GlassDropdownMenuItem>
    <GlassDropdownMenuItem destructive>Delete</GlassDropdownMenuItem>
  </GlassDropdownMenuContent>
</GlassDropdownMenu>
```

### The three dots of a toolbar

```tsx
import { Archive, ArrowLeft, BellOff, Clock, Ellipsis, Flag, MailOpen, Tag, Trash2 } from 'lucide-react'

import { GlassButtonGroup, GlassButtonGroupItem } from '@/components/liquid-glass'
import {
  GlassDropdownMenu,
  GlassDropdownMenuContent,
  GlassDropdownMenuItem,
  GlassDropdownMenuSeparator,
  GlassDropdownMenuTrigger,
} from '@/components/liquid-glass/glass-dropdown-menu'

const COLS = 13
const ROWS = 7

/** 1 around the middle of the grid, falling to 0 at its edge. */
const fade = (col: number, row: number) => {
  const distance = Math.hypot((col - (COLS - 1) / 2) / (COLS / 2), (row - (ROWS - 1) / 2) / (ROWS / 2))
  return Math.min(1, Math.max(0, (1 - distance) / 0.45))
}

// The actions of a message. Some share a body of glass, some stand apart: nested groups, with
// the outer one only spacing them. The glass is white unless a group brings its own colour,
// as the back button does. Snooze stands apart in clear glass (`material="clear"`): it bends the
// grid, and its rim mirrors the white glass beside it. The three dots stand apart and open a
// menu that stretches out of them.
// Where the row would not fit (a phone), the labels step aside and the icons carry it.
// Point at a body and it swells; press and it grows. Behind them, the Press demo's fine grid
// on the page's own colour, centred on the glass: plain DOM, every cell draws its own top
// and left line, fainter towards the edge.
export default function Demo() {
  return (
    <div className="@container relative isolate flex h-72 w-full max-w-xl items-center justify-center">
      <div aria-hidden className="absolute top-1/2 left-1/2 -z-10 grid -translate-x-1/2 -translate-y-1/2 grid-cols-[repeat(13,40px)]">
        {Array.from({ length: COLS * ROWS }, (_, i) => (
          <span key={i} className="relative size-10" style={{ opacity: fade(i % COLS, Math.floor(i / COLS)) }}>
            <span className="absolute inset-x-0 top-0 h-px bg-black/10 dark:bg-white/10" />
            <span className="absolute inset-y-0 left-0 w-px bg-black/10 dark:bg-white/10" />
          </span>
        ))}
      </div>
      <GlassButtonGroup aria-label="Message">
        <GlassButtonGroup className="bg-neutral-900 text-white">
          <GlassButtonGroupItem aria-label="Back" className="px-0">
            <ArrowLeft />
          </GlassButtonGroupItem>
        </GlassButtonGroup>
        <GlassButtonGroup>
          <GlassButtonGroupItem className="@max-[440px]:px-0">
            <Archive />
            <span className="@max-[440px]:sr-only">Archive</span>
          </GlassButtonGroupItem>
          <GlassButtonGroupItem className="@max-[440px]:px-0">
            <Flag />
            <span className="@max-[440px]:sr-only">Report</span>
          </GlassButtonGroupItem>
        </GlassButtonGroup>
        <GlassButtonGroup material="clear">
          <GlassButtonGroupItem className="@max-[440px]:px-0">
            <Clock />
            <span className="@max-[440px]:sr-only">Snooze</span>
          </GlassButtonGroupItem>
        </GlassButtonGroup>
        <GlassDropdownMenu>
          <GlassButtonGroup>
            <GlassDropdownMenuTrigger asChild>
              <GlassButtonGroupItem aria-label="More" className="px-0">
                <Ellipsis />
              </GlassButtonGroupItem>
            </GlassDropdownMenuTrigger>
          </GlassButtonGroup>
          <GlassDropdownMenuContent>
            <GlassDropdownMenuItem>
              <MailOpen />
              Mark as read
            </GlassDropdownMenuItem>
            <GlassDropdownMenuItem>
              <Tag />
              Add label
            </GlassDropdownMenuItem>
            <GlassDropdownMenuItem>
              <BellOff />
              Mute thread
            </GlassDropdownMenuItem>
            <GlassDropdownMenuSeparator />
            <GlassDropdownMenuItem destructive>
              <Trash2 />
              Delete
            </GlassDropdownMenuItem>
          </GlassDropdownMenuContent>
        </GlassDropdownMenu>
      </GlassButtonGroup>
    </div>
  )
}
```

## API reference

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `open / defaultOpen / onOpenChange` | `boolean / boolean / (open: boolean) => void` | — | On `GlassDropdownMenu`: control the menu yourself, or let it keep its own state. |
| `GlassDropdownMenuTrigger asChild` | `boolean` | `false` | Put the trigger on its single child (a `GlassButtonGroupItem`) instead of a glass button of its own. |
| `GlassDropdownMenuContent side / align` | `'top' \| 'bottom' / 'start' \| 'center' \| 'end'` | `'bottom' / 'center'` | Where the list opens against the trigger: below and centred by default. It flips when there is no room. |
| `GlassDropdownMenuContent sideOffset` | `number` | `12` | The gap between the control and the list, where the neck stretches. |
| `GlassDropdownMenuItem onSelect` | `() => void` | — | Runs when the item is pressed; the menu then closes (`closeOnSelect={false}` keeps it open). |
| `GlassDropdownMenuItem destructive` | `boolean` | `false` | Paints the item red, for Delete. |
| `GlassDropdownMenuItem disabled` | `boolean` | `false` | Dimmed and skipped by the keyboard. |
| `GlassDropdownMenuSeparator` | `className` | — | A hairline between items. |

## Accessibility

- A button with `aria-haspopup` that opens a `menu` of `menuitem`s (the WAI-ARIA menu button pattern).
- Arrow keys, Home and End move through the items, typing a letter jumps to a match, Enter runs the item, Escape closes and returns focus to the trigger.
- An icon-only trigger needs an `aria-label`.
- With reduced motion the list opens and closes at once. Without WebGL2 it is a plain frosted list.

Source: https://liquid-glass-interface.pages.dev/docs/dropdown-menu
