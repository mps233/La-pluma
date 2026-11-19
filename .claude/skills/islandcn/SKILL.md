---
name: islandcn
description: Add islandcn, the open-source Dynamic Island for React, to a React or shadcn/ui app and shape it around the app's own actions (lib/island). Use when the user asks for an island, a Dynamic Island pill, a live activity or live status at the top of the screen, or an island for an upload, download, timer, countdown, now playing, incoming call, ride or delivery ETA, checkout or payment, recording indicator, file transfer, battery or charging, a long-running job or build, a live score, a price or stock ticker, an order with stages, a flight or trip, a workout, a focus session, a sign-in code, a live transcript or translation, or two activities at once, or when code imports lib/island or components/islandcn.
---

# islandcn

islandcn is the open-source Dynamic Island for React, built for any web app. It draws a black pill at the top of the app and turns it into live status for whatever the app is doing, in four presentations (idle, compact, minimal, expanded) that move between each other on springs measured from simulator recordings of the reference phone. You build the island for the app's own actions on top of it; the playground at https://islandcn.dev/playground builds one by hand and copies the code.

The presets (upload, timer, now playing, incoming call, ETA, recording, nearby transfer, battery, split) are examples, not a menu. Install one only when it is exactly what the user asked for. Otherwise write a new activity on the engine: section 3 maps any app event onto the island, and [references/recipes.md](references/recipes.md) has a complete file for the common shapes (progress, countdown, stages, two sides, readings, an approval) and a written pattern, with the kit pieces to use, for others (a price, a code that expires, a transcript).

## 1. Set up the engine

Look for `lib/island/index.ts` under the `lib` alias in `components.json` (imports below use `@/lib/island`; use the project's alias). If it is missing, install it:

```bash
npx shadcn@latest add https://islandcn.dev/r/island-core.json
```

The engine needs React 19 and adds no npm packages. For content, also install the kit the presets share. It brings text styles, the expanded view's layout pieces, an original glyph set sized to the pill, a progress ring and bar, and `useActivity`. It adds no npm packages:

```bash
npx shadcn@latest add https://islandcn.dev/r/island-content.json https://islandcn.dev/r/progress-ring.json https://islandcn.dev/r/linear-progress.json
```

Add the other kit pieces the island needs, one registry item each (`npx shadcn@latest add https://islandcn.dev/r/<item>.json`):

| The island shows | Item | Export |
| --- | --- | --- |
| A clock that counts up or down by itself | `ticking-time` | `TickingTime` |
| A ring that runs down to a moment (a code, a session) | `countdown-ring` | `CountdownRing` |
| Named stages or counted rounds (an order, a build, sets) | `step-progress` | `StepProgress`, `stepsAt` |
| A trend (a price, a heart rate, a queue) | `sparkline` | `Sparkline` |
| Two to four labelled readings (pace, gate, seat) | `metric` | `Metric`, `MetricRow` |
| Growing text whose newest words matter (a transcript) | `tail-text` | `TailText` |
| Sound or voice levels | `level-meter` | `LevelMeter` |
| Buttons (Approve, Pay, Pause) | `island-button` | `IslandButton`, `IslandRoundButton` |
| A cover, a photo, a logo | `artwork` | `Artwork` (`src` for your image) |
| A person or a team | `avatar` | `Avatar` (`src` for a photo or crest) |
| Working with no known end | `spinner`, `shimmer-text` | `Spinner`, `ShimmerText` |

The glyphs are Hugeicons (free set, MIT), drawn at the island's weight; `island-content` installs `@hugeicons/core-free-icons` and `@hugeicons/react`. For a shape the set doesn't name (a lock, a card), turn any free Hugeicons icon into a glyph: `const LockGlyph = glyphFrom("LockGlyph", LockIcon)` with `LockIcon` from `@hugeicons/core-free-icons`, then `<Glyph icon={LockGlyph} />`. Pass `{ parts: "fill" }` for a solid shape such as a play button.

Then mount the island once, as high as the components that will start activities. `IslandProvider` holds state, so in the Next.js App Router it goes in a `"use client"` file that the root layout renders:

```tsx
"use client";

import type { ReactNode } from "react";

import { Island, IslandProvider } from "@/lib/island";

export const Providers = ({ children }: { children: ReactNode }) => (
  <IslandProvider>
    <Island placement="viewport" />
    {children}
  </IslandProvider>
);
```

In Vite, wrap the app in `main.tsx` the same way. Search the project for `IslandProvider` first; mount it only if no one has. `placement="viewport"` pins the island to the top centre of the window; leave it out to draw it at the top of a positioned container, such as a phone-sized frame.

Done when `lib/island/index.ts` exists, the app renders exactly one `<Island />` inside one `IslandProvider`, and the page shows a black capsule at the top centre when nothing runs.

## 2. Pick the presentations

The engine picks the presentation; you supply content for each one the island can reach.

| Presentation | Shows when | You provide |
| --- | --- | --- |
| `idle` | Nothing runs | Nothing |
| `compact` | One activity runs | `compact.leading` and `compact.trailing`: a glyph and a short value, either side of the sensor |
| `minimal` | Two activities show (the split) | Nothing new: on the reference phone each shape shows its activity's `compact` pair. `minimal` (a `<MinimalPair />`) is the fallback when the pair is too wide for the split |
| `expanded` | Long-press, `island.expand(id)`, or an alert | `expanded.leading`, `center`, `trailing` on the top row, `bottom` below: detail and controls |

Always provide `compact`, and a `minimal` fallback. Provide `expanded` whenever there is detail or an action (a button, a progress bar, a title).

With two activities, the one with the higher `priority` (then the earlier start) keeps the attached pill; the other moves to a capsule on its right. Give urgent things a higher priority: a call is 2, everything else 0. The capsule is a fixed 62.18 wide and leaves about 20 pt after a 22 pt glyph, so keep `compact.trailing` that short (one or two digits, a short meter) or accept that it is cut there.

When several activities come from one source and only one matters at a time (orders from one shop, runs of one agent), give them the same `group`. They then take turns instead of splitting, as one app's live status activities do: the first started shows, and an alert on a hidden one hands the island over to it. Leave `group` out for different tasks the user wants side by side, such as a timer and music.

Use `alert: true` only when the user must notice now: a call rings, a job fails, a delivery arrives. It expands for `motion.alertHold` seconds and folds back. When the island must stay open until the user answers (an approval), call `island.expand(id)` instead. Never alert on routine progress.

## 3. Map the app's events onto the island

Any app event fits the island once you answer three questions about it:

1. **What is it?** One mark that says so at a glance: a glyph, a crest, a cover, an avatar, a ring. This is `compact.leading`.
2. **What does a glance need?** One short value: minutes left, a score, a percentage, a gate, a heart rate, a code. This is `compact.trailing`: up to about six characters, 72 pt at most.
3. **What does a look need?** The detail and the actions. This is `expanded`.

Then give the split capsule its form. The capsule leaves about 20 pt after the leading glyph: one or two digits, a 20 pt ring, a short meter. When the trailing value is wider ("18 min", "B32", "4:31", "482 913"), wrap the pair in `withBubble(compact, bubble)` from `island-text` so the capsule shows `bubble` (a ring, the glyph, a `CountdownRing`) instead of an ellipsis, or wrap one slot in `<BubbleForm bubble={...}>` to change just that slot ("18 min" in the pill, "18" in the capsule). Give `minimal` a `<MinimalPair>` of the same mark and value.

Pick the expanded layout by what the event is:

| Event is | Expanded layout | Examples |
| --- | --- | --- |
| Work moving toward an end | **Label-led.** `leading`: `<SensorRow glyph>` with a `<ContextLabel>`; `trailing`: a time, a status caption or a 26 pt control in `<SensorRow align="end">`; `bottom`: the title or big value, its detail, then `<BottomBar>` with a `LinearProgress` or `StepProgress` | upload, export, build, order, delivery, focus session, sign-in code |
| Something with a picture | **Media-led.** `leading`: the image in `<ExpandedSide>` (`Artwork`, `Avatar`, a map); `center`: `<TitleStack>`; `trailing`: `<ValueStack>` or buttons in `<ExpandedSide align="end">`; `bottom`: controls | music, call, ride, payment, a message |
| Two sides of one thing | **Two sides.** `leading`: side A's mark and value in `<ExpandedSide>`; `trailing`: side B mirrored in `<ExpandedSide align="end">`; `center`: what joins them (the period and clock, a route's status); `bottom`: one line of news | a game score, a route from one code to another, a trade |
| Several readings at once | **Readings.** A label-led top row, then `<MetricRow>` in `<ExpandedBottom reach="inset">`, and a `Sparkline` if the trend matters | a workout, a flight's gate and seat, a device's stats |

The label beside the sensor has about 100 pt: an 18 pt glyph and eight or nine characters of 15 pt text ("Order", "Bitcoin", "IC 482" fit; "Outdoor Run" does not). A longer name ("Noodle Bar Downtown", "Bitcoin and Ether") ends in an ellipsis there, so put it in the bottom title and keep the label to what is happening ("Order", "Bitcoin", "Focus").

Then wire each app event to one island call:

| App event | Island call |
| --- | --- |
| The task starts | `island.start(...)`, or mount a component that calls `useActivity` |
| A value moves (progress, price, score, distance) | `update` in place: `NumberText` digits turn over, `LinearProgress` springs |
| The value ticks every second or faster (a clock, a countdown, levels) | Nothing per tick: `TickingTime`, `CountdownRing` or `LevelMeter` read the source themselves |
| It reaches a new stage (preparing to on the way, step 2 to 3, a new track) | `update` with `transition: "crossfade"` |
| Something the user must notice now (failed, gate changed, delivered, a code arrived) | `update` with `alert: true` (or `alert: true` on `start`): it expands, holds about 6 s, folds back |
| It needs an answer (approve, pay, accept) | `island.expand(id)` and keep it open; `island.collapse()` once answered |
| It finishes | Show the final state (an alert, or a check for a few seconds), then `end` |
| A second, unrelated task starts | Start it: the island splits. Give the more urgent one the higher `priority` |
| Another one from the same source (a second order, another run) | Same `group`, so they take turns instead of splitting |

## 4. Build the activity

Write one component or hook per island, next to the feature it reports on. The simplest shape is a component that renders while the task runs: `useActivity` from the content kit starts the activity on mount, updates it when its inputs change, and ends it on unmount.

```tsx
"use client";

import { Glyph } from "@/components/islandcn/glyph";
import { DocumentPlusGlyph } from "@/components/islandcn/glyphs";
import { BottomBar, ExpandedBottom, SensorRow } from "@/components/islandcn/island-layout";
import { CompactText, ContextLabel, ExpandedSubtitle, ExpandedValue, MinimalPair, NumberText } from "@/components/islandcn/island-text";
import { LinearProgress } from "@/components/islandcn/linear-progress";
import { ProgressRing } from "@/components/islandcn/progress-ring";
import { islandAccent, islandInk } from "@/components/islandcn/theme";
import { useActivity } from "@/components/islandcn/use-activity";

interface ExportIslandProps {
  /** Export progress, 0 to 1. */
  progress: number;
  /** File being written, such as "Q3 report.pdf". */
  fileName: string;
}

/** Render while an export runs; unmount when it ends. */
export const ExportIsland = ({ progress, fileName }: ExportIslandProps) => {
  const percent = Math.round(progress * 100);
  const accent = islandAccent.blue;
  useActivity(
    () => ({
      id: "export",
      label: `Exporting ${fileName}, ${percent} percent`,
      // Also what the split shows; a 20 pt ring fits the capsule's trailing room.
      compact: {
        leading: <Glyph icon={DocumentPlusGlyph} color={accent} />,
        trailing: <ProgressRing value={progress} color={accent} size={20} />,
      },
      // Fallback for a split too wide for both compact pairs.
      minimal: <MinimalPair leading={<ProgressRing value={progress} color={accent} />} trailing={<CompactText><NumberText value={`${percent}%`} /></CompactText>} />,
      expanded: {
        // What is happening, beside the sensor: a small glyph in the accent and a quiet label.
        leading: (
          <SensorRow glyph={<Glyph icon={DocumentPlusGlyph} color={accent} size={18} />}>
            <ContextLabel>Exporting</ContextLabel>
          </SensorRow>
        ),
        // The value large and white, the sign at the figure's size; the file under it; the bar last.
        bottom: (
          <ExpandedBottom gap={6}>
            <ExpandedValue unit="%">
              <NumberText value={percent} />
            </ExpandedValue>
            <ExpandedSubtitle color={islandInk.primary}>{fileName}</ExpandedSubtitle>
            <BottomBar>
              <LinearProgress value={progress} color={accent} height={5} />
            </BottomBar>
          </ExpandedBottom>
        ),
      },
    }),
    [fileName, percent, progress, accent],
  );
  return null;
};
```

`useActivity` builds the content only in the browser, so the content may read the clock (`until: Date.now() + 25 * 60_000`) even in a Next.js app that prerenders (`cacheComponents`). Don't call `island.start` during render; call it from an effect or an event handler.

For event streams (an agent, a socket), use the hook directly: `const island = useIslandActions()` (or `useIsland()` if the component also renders `activities` or `presentation`), then `island.start(...)` returns a handle with `update` and `end`. Updates merge, so `{ compact: { trailing } }` keeps the leading slot. For values that change many times a second, render a component that reads the state itself instead of calling `update` on every tick.

Updates apply in place. Draw changing numbers with `IslandNumber` (or the kit's `NumberText`) and bars with `IslandProgress` (or the kit's `LinearProgress`), and their digits turn over and their fill springs as on the reference phone. When the content is different rather than newer (a new step, a new track), pass `transition: "crossfade"` on the update.

The expanded view reads top to bottom. `leading` and `trailing` start at the top beside the sensor and `center` starts below it. For progress, a countdown or a status, lead with a `<SensorRow>`: a small glyph and a `<ContextLabel>` saying what is happening, and on the trailing side a small control or a time. Then put the key value large in `bottom` (`<ExpandedValue>`, with a "%" set at the figure's size), its detail on the same baseline or the line under it, and a bar in `<BottomBar>`, which keeps its ends clear of the corners. Don't put an app-style coloured tile in the leading region: a glyph and a label read as the system's own, and a tile reads as an app launcher. Real images are different: album art, an avatar or a map snapshot can take the leading region, framed with the kit's `<ExpandedSide>`, beside a `<TitleStack>` in `center`. A big value beside a title goes in `<ValueStack>`, with an optional caption on the subtitle's line.

The full API is in [references/api.md](references/api.md). Patterns for common islands (progress, countdown, stages, two sides, readings, a price, a code that expires, a transcript, approval, call, a one-off notice, the split, groups) are in [references/recipes.md](references/recipes.md).

## 5. Meet the quality bar

The island looks right only when these hold. Check each one before you finish; [references/design.md](references/design.md) has the measured numbers.

- **Pure black.** The engine fills the pill `#000`. Never tint it or add a gradient or your own shadow (the engine adds the expanded shadow). Colour goes on the content.
- **Readable on its background.** On a light page the black pill reads like hardware. On a dark page the engine draws the faint grey keyline the phone draws; pass the page colour as `<Island backdrop="#0b0b0f" />` so it gets the right strength. Don't paint the pill or add a border to compensate.
- **A capsule at rest.** Idle is a plain black capsule, 94.85 × 36.84, with nothing inside.
- **Content clears the sensor.** In compact, leading content sits left of the sensor area and trailing content right of it; the middle stays empty. Compact grows outward from the idle pill, so it can sit slightly off centre; the shorter side grows to at least 0.7475 of the longer one and keeps its content at the outer edge. That gap is measured behaviour, not a bug to pad away.
- **Concentric content.** The 22 pt compact glyph sits 7.4 pt from the pill's ends, top and bottom. In expanded, images and buttons near a corner follow it: radius = outer radius − inset.
- **Short compact content.** One glyph on the leading side and at most about six characters on the trailing side (each slot is at most 72 wide). Tabular numbers for anything that ticks.
- **The split.** Each half of the split shows its activity's compact pair, and the capsule's trailing value fits in about 20 pt; a wider value uses `withBubble` or `BubbleForm` (section 3). Check it with a second activity running.
- **Level expanded rows.** `leading` and `trailing` start at the top. If side content looks like it floats above the title beside it, give it an `ExpandedSide` frame rather than padding.
- **Labels that fit.** The label beside the sensor reads whole (eight or nine characters after an 18 pt glyph). A name that is cut there belongs in the bottom title.
- **White and system type.** Text is white, secondary text at about 62% (`islandInk.secondary`), in the system font stack. Don't bundle a system font file or a system symbol font. Use the kit's glyphs (`glyphs.tsx`), or an open icon set, filled, for a shape they don't draw.
- **Springs, not tweens.** Don't animate the pill or its content yourself. Change the presentation or the content and let the engine move it. Numbers use `IslandNumber`, bars `IslandProgress`.
- **Reduced motion.** Check once with `prefers-reduced-motion: reduce`: the shape eases with no overshoot and content crossfades without blur. Your own content animations check `useIslandReducedMotion()`.
- **Accessible.** Give every activity a `label` that says what it is and its state; screen readers read it, and it names the pill button.

Done when the island starts, updates and ends from real app state, every presentation it can reach has content, and it passes the checks above at desktop and phone widths.

## 6. Install a preset

When a preset is exactly what the user asked for, install its registry item:

```bash
npx shadcn@latest add https://islandcn.dev/r/<item>.json
```

| Preset | Item | Main export |
| --- | --- | --- |
| Upload | `upload-activity` | `UploadActivity` |
| Timer | `timer-activity` | `TimerActivity` |
| Now playing | `now-playing-activity` | `NowPlayingActivity` |
| Incoming call | `call-activity` | `CallActivity` |
| Ride or delivery ETA | `eta-activity` | `EtaActivity` |
| Recording | `recording-activity` | `RecordingActivity` |
| Nearby transfer | `nearby-transfer-activity` | `NearbyTransferActivity` |
| Battery | `battery-activity` | `BatteryActivity` |
| Split (demo of two at once) | `split-demo` | `SplitDemo` |

Each writes `components/islandcn/<item>.tsx` (the split demo writes `examples/`) and pulls in `island-core` and `island-content`. Docs with props for every preset: https://islandcn.dev/docs/presets.
