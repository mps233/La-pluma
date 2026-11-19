# islandcn API

The engine's public API, from `lib/island/README.md` in the installed engine (read that file too: it matches the installed version). Import everything from `@/lib/island`.

```tsx
import { Island, IslandNumber, IslandProgress, IslandProvider, IslandView, useIsland, useIslandActions, useIslandReducedMotion } from "@/lib/island";
import type { ActivityHandle, ActivityOptions, ActivityUpdate, IslandApi } from "@/lib/island";
```

```ts
import type { CSSProperties, ReactNode } from "react";

import type {
  Activity,
  CompactContent,
  IslandClock,
  IslandMetricsOverrides,
  IslandMotionOverrides,
  IslandSequence,
  SpringConfig,
} from "@/lib/island";

// Provider: owns the activity stack and the clock.
interface IslandProviderProps {
  children: ReactNode;
  clock?: IslandClock;                       // read once; default requestAnimationFrame
  devtools?: boolean | { sequences?: Record<string, IslandSequence> }; // default false
  metrics?: IslandMetricsOverrides;          // deep-partial overrides of islandMetrics
  motion?: IslandMotionOverrides;            // deep-partial overrides of islandMotion
  reducedMotion?: "user" | "always" | "never"; // default "user"
}

// The stack-driven island.
interface IslandProps {
  placement?: "container" | "viewport";      // default "container"
  label?: string;                            // region name, default "Live activities"
  className?: string;
  style?: CSSProperties;
  keyline?: "auto" | "on" | "off";           // default "auto"
  backdrop?: string;                         // page colour behind the island, sets keyline strength
}

declare const useIsland: () => IslandApi;            // subscribes: re-renders on island changes
declare const useIslandActions: () => IslandApi;     // same API, never re-renders the caller
declare const useIslandReducedMotion: () => boolean; // provider setting resolved against the system's

interface IslandApi {
  start(options: ActivityOptions): ActivityHandle; // same id again updates it
  update(id: string, update: ActivityUpdate): void;
  end(id: string): void;                     // dismiss with the system motion
  expand(id?: string): void;                 // default: the primary activity; brings a hidden group member forward
  collapse(): void;
  readonly activities: readonly Activity[];  // primary first, hidden group members included
  readonly presentation: "idle" | "compact" | "minimal" | "expanded";
}

interface ActivityOptions {
  id: string;
  label?: string;                            // spoken by screen readers, default the id
  priority?: number;                         // default 0
  onPress?: () => void;                      // tap (released within 0.1 s)
  alert?: boolean;                           // expand briefly on start
  group?: string;                            // share a group to show one at a time (one app's activities)
  compact?: { leading?: ReactNode; trailing?: ReactNode }; // also what the split shows
  minimal?: ReactNode;                       // fallback when the split is too wide for the compact pairs
  expanded?: { leading?: ReactNode; trailing?: ReactNode; center?: ReactNode; bottom?: ReactNode };
}

// Partial: nested content merges, so { compact: { trailing } } keeps the leading slot.
interface ActivityUpdate {
  compact?: { leading?: ReactNode; trailing?: ReactNode };
  minimal?: ReactNode;
  expanded?: { leading?: ReactNode; trailing?: ReactNode; center?: ReactNode; bottom?: ReactNode };
  label?: string;
  priority?: number;
  onPress?: () => void;
  alert?: boolean;                           // expands with the old content, applies this 0.12 s later, back after alertHold
  transition?: "update" | "crossfade";       // default "update" (in place)
}

interface ActivityHandle {
  readonly id: string;
  update(update: ActivityUpdate): void;
  end(): void;
}

// Content primitives, on the island's clock.
interface IslandNumberProps {
  value: number | string;                    // changed characters turn over with a blur
  className?: string;
  style?: CSSProperties;
}
interface IslandProgressProps {
  value: number;                             // 0 to 1; the fill springs to it
  color?: string;                            // default "#30D158"
  track?: string;                            // default "#414141"
  height?: number;                           // default 8
  radius?: number;                           // default height / 2
  spring?: SpringConfig;                     // default { response: 0.97, dampingFraction: 0.74 }
  className?: string;
  style?: CSSProperties;
}

// One presentation, controlled, without the stack. Not pressable. For docs, Studio, captures.
interface IslandViewProps {
  presentation:
    | { kind: "idle" }
    | { kind: "compact"; leading?: ReactNode; trailing?: ReactNode }
    | { kind: "minimal"; attached: ReactNode; detached?: ReactNode; split?: { attached: CompactContent; detached: CompactContent } }
    | { kind: "expanded"; leading?: ReactNode; trailing?: ReactNode; center?: ReactNode; bottom?: ReactNode };
  contentKey?: string;                       // default presentation.kind; new key crossfades, same key updates in place
  pressed?: boolean;                         // the hold squish
  placement?: "container" | "viewport";
  label?: string;                            // default "Live activity"
  liveLabel?: string;
  clock?: IslandClock;
  metrics?: IslandMetricsOverrides;
  motion?: IslandMotionOverrides;
  reducedMotion?: "user" | "always" | "never";
  className?: string;
  style?: CSSProperties;
  keyline?: "auto" | "on" | "off";
  backdrop?: string;
}
```

`IslandView` works inside or outside a provider. Inside, it uses the provider's clock, metrics and motion.

Primary means highest `priority`, then first started, among the activities on show. Activities that share a `group` show one at a time.

## Layout rules (measured on the reference phone)

- **Compact balance.** Each compact side fits its content, up to 72 wide (`metrics.compact.maxSlotWidth`; a longer plain string ends in an ellipsis, other content is clipped). With content on both sides, neither side reaches less than 0.7475 of the other beyond the sensor (`metrics.compact.balance`): the short side grows and its content stays at the outer edge.
- **The split.** Each shape shows its activity's compact pair. The attached pill ends at the sensor's right edge and grows left; the capsule sits 7.82 to its right and is 62.18 wide whenever it has a trailing value. That value is centred in the room after the leading glyph (about 20 pt after a 22 pt glyph); a plain string wider than that ends in an ellipsis ("12:45" shows "1…"), other content is clipped. When the two shapes together would span more than 290 (`metrics.split.maxSpan`), each falls back to its `minimal` view.
- **The expanded row is top-aligned.** `leading` and `trailing` start at the top beside the sensor; `center` starts below the sensor's bottom edge (about 20 pt lower). Content that should sit level with a taller neighbour brings its own frame (the kit's `ExpandedSide`).
- **Corners** are continuous (an arc easing into the edges). The expanded radius is 47.9 (48.2 measured as a plain circle); content is clipped to a concentric rounded rectangle with radius 34.4, so a square tile or a bar reaching a bottom corner loses its corner.

## Groups

Activities with the same `group` show one at a time, as one app's live status activities do. The first started shows; the others wait hidden and are still listed in `activities`. An alert on a hidden one hands over: the shown one leaves to idle, the island waits `motion.group.handoff` (1.458 s), expands the alerting one already showing its update, and returns to it compact `motion.group.window` (6.014 s) after the departure. The one that left stays hidden. `expand(id)` on a hidden one brings it forward without the pause; ending the one brought forward shows the first started again.

## Updates

`update` changes content in place: the same layer, so `IslandNumber` turns over the digits that changed and `IslandProgress` springs its fill. `transition: "crossfade"` replaces the layer with a blur and fade, for content that is different rather than newer. An alerting update expands with the old content and applies the new one `motion.alertContentDelay` (0.12 s) later; it returns to compact after `motion.alertHold` (5.975 s).

## Keyline

On dark pages the engine draws a thin grey band just outside the black edge, as the phone does (1.5 pt, white at 0.16 over #000, fading to nothing by about #2C2C2E). `keyline="auto"` draws it when `backdrop` is dark, or in dark mode when no `backdrop` is given; `"on"` and `"off"` force it. Pass the page colour as `backdrop` when you know it.

## Interaction and accessibility

- The island is a `region` with a label. The pill is a real `button` named after the activity, with `aria-expanded`. A polite live region reads the activity labels when they change.
- Every press swells the pill from touch-down. Still held at 0.1 s, it is a long-press and the island expands at `motion.longPress` (0.22 s after touch-down). Released sooner, it is a tap: `onPress` runs and the swell springs back. Hold the detached capsule to expand the second activity; only the capsule swells.
- Enter or Space toggles expanded. Escape, or a press outside the island, collapses it. Focus inside content that goes away moves back to the pill.
- Expanded content takes pointer events and focus, so buttons inside it work.
- `prefers-reduced-motion`: the shape eases over 0.2 s with no overshoot, and content crossfades with no blur or scale. `IslandNumber` fades plainly, `IslandProgress` eases over 0.2 s.

## Tables

All geometry lives in `islandMetrics` (`lib/island/metrics.ts`) and all timing in `islandMotion` (`lib/island/motion.ts`). Override per app with the provider's `metrics` and `motion` props; both merge one group at a time:

```tsx
import { Island, IslandProvider } from "@/lib/island";

import { App } from "./app";

export const Root = () => (
  <IslandProvider
    motion={{ shape: { expand: { response: 0.42, dampingFraction: 0.78 } }, alertHold: 4 }}
    metrics={{ top: 10 }}
  >
    <Island placement="viewport" />
    <App />
  </IslandProvider>
);
```

Transitions with their own shape spring (`shapeTransitions`): `appear`, `expand`, `pressExpand`, `appearExpand`, `swap`, `collapse`, `collapseSplit`, `split`, `unsplit`, `dismiss`, `resize`. The detached capsule has its own springs under `motion.bubble`.

## Content kit (`island-content` and friends)

Optional, from the same registry. Every preset uses it.

| Import | What |
| --- | --- |
| `@/components/islandcn/theme` | `islandAccent` (lagoon, green, red, orange, yellow, blue, sky, pink, purple), `islandInk` (primary, secondary, tertiary, track, fill), `islandSize` (compactGlyph 22, expandedTile 52, title 17, subtitle 15), `islandLine` (line heights), `islandRow` (frame heights for the top-aligned expanded row: `titleStack` 63.07, `subtitle` 40.07, `centerTop` 20.07), `islandSafe` (insets that keep expanded content clear of the corner arcs, leading and trailing apart), `islandTracking` and `trackingFor(size)` (letter spacing for system-font text at 17, 20 and 34 pt), `continuousCorner(w, h, radius)` (a `clip-path` for a continuous-corner rounded square), `islandFont`, `tint(hex, alpha)` |
| `@/components/islandcn/glyphs` | the glyph set, Hugeicons' free icons drawn at the weight of system glyphs (solid where those are): media (`PlayGlyph`, `PauseGlyph`, `StopGlyph`, `NextTrackGlyph` ...), calls (`PhoneGlyph`, `HangUpGlyph`), status (`CheckGlyph`, `WarningGlyph`, `BellGlyph`, `MessageGlyph`), tasks (`UploadGlyph`, `PackageGlyph`, `TerminalGlyph` ...), capture, travel (`CarGlyph`, `PinGlyph`, `HouseGlyph`), devices, food and `BoltGlyph`. Each takes `size` (default 22) and `color` (default `currentColor`). `islandGlyphs` has them all by name; `glyphFrom(name, icon, { parts, place, layers })` makes one from any free Hugeicons icon: `parts` draws each element as an outline (`"line"`), solid (`"fill"`) or cut out of the solid ones (`"cut"`), `place` moves, scales, turns or mirrors it, and `layers` stacks more icons on it |
| `@/components/islandcn/glyph` | `<Glyph icon color />` sized for compact; `<IconTile icon accent />`, a 52 pt tile for expanded. `icon` is a `GlyphIcon`: an islandcn glyph, drawn at its own size, or an icon component from another set (`ForeignIcon`), scaled so its ink matches. `glyphFrom(name, hugeicon, { parts })` in `glyphs` makes a glyph from any free Hugeicons icon |
| `@/components/islandcn/island-text` | `CompactText`, `ExpandedTitle`, `ExpandedSubtitle`, `ContextLabel` (15 pt medium grey: what a label-led view is doing, beside the sensor), `ExpandedValue` (large number with a unit), `Caption`, `TitleStack` (title over subtitle), `NumberText` (`IslandNumber`, plain under reduced motion; `motion` "live", "steady" for a value fed every second, or "none"), `MinimalPair` (glyph and value for the `minimal` fallback), `withBubble(compact, bubble)` and `<BubbleForm bubble>` (what a compact pair or one slot shows in the split capsule instead, so a wide value never ends in an ellipsis there), `Swap` (blur one piece of content in when its id changes) |
| `@/components/islandcn/island-layout` | `SensorRow` (the row beside the sensor in a label-led view: `glyph` and a `ContextLabel`, or with `align="end"` a time, caption or 26 pt control; about 100 pt wide, so a label holds eight or nine characters), `BottomBar` (a bar or step row at the foot, its ends pulled in past the corner arcs), `ExpandedSide` (a fixed-height frame that centres leading or trailing content on the top-aligned row; `height` defaults to 52, `align` "start" or "end", `line` to centre it on a row line from `islandRow`), `ExpandedBottom` (the bottom region's root; `reach` keeps rows clear of the corner arcs: "inset" pulls a row with marks at both ends, such as a route or a meter, in from the sides so it stays on the bottom line, "lift" raises a full-width row of text, "action" insets a row of 44 pt controls), `ValueStack` (the trailing big value with an optional `caption` on the subtitle's line; `alone` for a one-row island), `CaptionButton` (a one-word action, such as Cancel, on a caption line, with a 44 pt touch area), `cornerClearance(size)` and `cornerSideClearance(size)` (how far to move a round control in from the bottom-trailing corner so the arc leaves it whole), `bottomInset`, `SensorSide` (an older glyph-and-label pair beside the sensor; prefer `SensorRow`) |
| `@/components/islandcn/use-activity` | `useActivity(build, deps)`: starts on mount, updates when deps change, ends on unmount; builds only in the browser, so `build` may read the clock. Returns `{ id, alert, expand, collapse }`. `useLatest(value)` keeps callbacks fresh without rebuilding content |
| `@/components/islandcn/media-row` (item `media-row`) | What a sharing activity is made of: `Thumbnail` (a photo with continuous corners, a glyph tile without one), `MediaLead`, `MediaText` (a 14 pt grey line over a 17 pt white sentence) and `MediaLine` (a name that ellipsizes before its detail), `MediaTrail`, `ShareRing` (20 or 48 pt, holding the percentage, a stop square or an arrow, a check at 1), `SharePicture` (a device or a person, with a photo badge), `mediaRow` and `mediaCompact` (the measurements) |
| `progress-ring` | `ProgressRing` (`value`, `color`, `size` 22, `thickness` 3, `children` in the middle) and `IconRing` (an icon in a ring that fills, tinted disc from 30 pt) |
| `linear-progress` | `LinearProgress` (through `IslandProgress`; `ends="square"` for a scrubber) and `TimeProgress` (a bar that fills with time from a `{ kind: "elapsed", since }` source by itself) |
| `ticking-time` | `TickingTime` (`source`: `{ kind: "elapsed", since }`, `{ kind: "remaining", until }` or `{ kind: "fixed", ms }`; `format`, default "4:07"; `formatMinutes` for whole minutes; `onEnd`). Counts without re-rendering you |
| `countdown-ring` | `CountdownRing` (`start`, `end` in epoch ms, `mode` "drain" or "fill", `size` 20, `onEnd`): a ring that runs down by itself, for a code that expires or a session |
| `step-progress` | `StepProgress` (`steps`: "done", "active", "failed" or "pending" per step; `shape` "bar" or "dots") and `stepsAt({ total, current, failed })` |
| `sparkline` | `Sparkline` (`values`, `color`, `width` (omit to fill the row), `height` 16, `area`, `baseline`, `dot`) |
| `metric` | `Metric` (`label`, `value`, `unit`, `color`, `align`) and `MetricRow` (`metrics`: two to four across the expanded view, outer ones to the edges) |
| `tail-text` | `TailText` (`text`, `size` 15 or 17, `weight`): one line that keeps its newest words in view under a fade |
| `level-meter`, `island-button`, `spinner`, `shimmer-text`, `artwork`, `avatar` | `LevelMeter` (`levels` for live input, `active`), `IslandButton` (`tone` neutral or accent, `size`, `fill`) and `IslandRoundButton`, `Spinner`, `ShimmerText`, `Artwork` (a generated cover, or your image via `src`), `Avatar` (a monogram, or a photo or crest via `src`) |
