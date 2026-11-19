# Recipes

Patterns for common islands, built on the engine and the content kit (`island-content`, `progress-ring`, `linear-progress`, `ticking-time`, `island-button`, `step-progress`, `countdown-ring`, `sparkline`, `metric`, `tail-text`, `avatar`). Each is a starting point: change the content to match the app. The presets are full versions of several of these; read their source in `components/islandcn/` for detail.

Every import the recipes use, in one place. Each recipe below is a complete file with its own imports:

```tsx
import { Glyph } from "@/components/islandcn/glyph";
import { TimerGlyph, WarningGlyph } from "@/components/islandcn/glyphs";
import { IslandButton } from "@/components/islandcn/island-button";
import { BottomBar, ExpandedBottom, ExpandedSide, SensorRow, ValueStack } from "@/components/islandcn/island-layout";
import { Caption, CompactText, ContextLabel, ExpandedSubtitle, ExpandedTitle, ExpandedValue, MinimalPair, NumberText, TitleStack } from "@/components/islandcn/island-text";
import { LinearProgress } from "@/components/islandcn/linear-progress";
import { ProgressRing } from "@/components/islandcn/progress-ring";
import { islandAccent } from "@/components/islandcn/theme";
import { TickingTime } from "@/components/islandcn/ticking-time";
import { useActivity, useLatest } from "@/components/islandcn/use-activity";
import { useIsland, useIslandActions } from "@/lib/island";
// The kit pieces for stages, readings, trends, codes and transcripts:
import { Avatar } from "@/components/islandcn/avatar";
import { CountdownRing } from "@/components/islandcn/countdown-ring";
import { BubbleForm, withBubble } from "@/components/islandcn/island-text";
import { Metric, MetricRow } from "@/components/islandcn/metric";
import { Sparkline } from "@/components/islandcn/sparkline";
import { StepProgress, stepsAt } from "@/components/islandcn/step-progress";
import { TailText } from "@/components/islandcn/tail-text";
```

## Sending something you can picture (a photo upload, a post, a share)

When the thing being sent has a picture, show it: a progress glyph alone reads as an abstract widget. These parts are in `media-row` (`npx shadcn@latest add https://islandcn.dev/r/media-row.json`).

- Compact: `<Thumbnail src={preview} fallback={UploadGlyph} accent={accent} radius={5.5} />` leading (24 pt; 22 in the split's bubble through `BubbleForm`, so the ring after it stays whole), `<ShareRing value={p} accent={accent} mark="count" />` trailing: a 20 pt ring with the percentage in it, a check at 1.
- Expanded: one row, no bottom region, so the island stays at the call's 84 pt. Leading `<MediaLead><Thumbnail src={preview} size={44} radius={16} fallback={UploadGlyph} accent={accent} /></MediaLead>` (44 pt with 16 pt corners: a 50 pt square there loses its corners to the island's content clip, so only a circle takes the full 50); center `<MediaText line={<MediaLine name={fileName} detail="2.5 of 6 MB" />} title="Uploading to Family" />` (the grey line first: a 17 pt line there would run under the sensor); trailing `<MediaTrail><ShareRing value={p} accent={accent} mark="count" size={48} /></MediaTrail>`.
- Going to someone: lead with them, not the file. `<SharePicture icon={LaptopGlyph} accent={accent} size={50} src={preview} />` puts the device on a faint disc with the photo on its corner; the text reads "Sending biscuit.jpg" over "To Maya's Laptop"; the ring takes `mark="stop"` with `onStop`, or `"up"` and `"down"` for the direction.
- Done: keep it mounted a moment at 1. The ring turns into a check; change the sentence to "Uploaded" or "Sent".
- Presets: `upload-activity`, `nearby-transfer-activity`.

## Progress without a picture (export, install, sync)

- Compact: the task's glyph leading, `<ProgressRing value={p} size={20} />` trailing (20 pt fits the split capsule's room); a check glyph at 100%.
- Minimal fallback: `<MinimalPair leading={<ProgressRing value={p} />} trailing={<CompactText><NumberText value={`${percent}%`} /></CompactText>} />`.
- Expanded: read top to bottom, with no app-style tile. Leading: `<SensorRow glyph={<Glyph icon={UploadGlyph} color={accent} size={18} />}><ContextLabel>Uploading</ContextLabel></SensorRow>`; trailing, when the task can be cancelled, a 26 pt `IslandRoundButton` in `<SensorRow align="end">`, which keeps it level with the label. Bottom, in `<ExpandedBottom gap={6}>`: a row with `<ExpandedValue unit="%"><NumberText value={percent} /></ExpandedValue>` (white, the sign at the figure's size) and the detail ("23 of 48 MB") on its baseline at the right (`display: flex; align-items: baseline; justify-content: space-between`); the file name in white semibold with the destination after it in grey; then `<BottomBar><LinearProgress value={p} height={5} /></BottomBar>`, which pulls the bar's ends in past the corner arcs.
- Drive it from state with `useActivity(..., [percent])`. Round to whole percent in the deps so it rebuilds at most 100 times. The digits turn over (`IslandNumber`) and the bar springs (`IslandProgress`) on each update.
- No preset uses this layout now; the upload leads with its photo (above).

## Countdown (timer, auction, session expiry)

```tsx
"use client";

import type { ReactNode } from "react";

import { Glyph } from "@/components/islandcn/glyph";
import { TimerGlyph } from "@/components/islandcn/glyphs";
import { ExpandedSide } from "@/components/islandcn/island-layout";
import { CompactText, ExpandedSubtitle, ExpandedValue, MinimalPair } from "@/components/islandcn/island-text";
import { islandAccent } from "@/components/islandcn/theme";
import { TickingTime } from "@/components/islandcn/ticking-time";
import { useActivity } from "@/components/islandcn/use-activity";

// `controls` is your pause and cancel pair: two 48 pt round buttons.
export const TeaTimerIsland = ({ endsAt, controls }: { endsAt: number; controls: ReactNode }) => {
  useActivity(
    () => ({
      id: "timer",
      label: "Tea timer",
      compact: {
        leading: <Glyph icon={TimerGlyph} color={islandAccent.orange} />,
        trailing: (
          <CompactText color={islandAccent.orange}>
            <TickingTime source={{ kind: "remaining", until: endsAt }} />
          </CompactText>
        ),
      },
      minimal: <MinimalPair leading={<Glyph icon={TimerGlyph} color={islandAccent.orange} />} trailing={<CompactText color={islandAccent.orange}><TickingTime source={{ kind: "remaining", until: endsAt }} /></CompactText>} />,
      expanded: {
        leading: controls,
        center: <ExpandedSubtitle>Tea</ExpandedSubtitle>,
        // The row is top-aligned: a frame as tall as the buttons keeps the time level with them.
        trailing: (
          <ExpandedSide height={48} align="end">
            <ExpandedValue color={islandAccent.orange}><TickingTime source={{ kind: "remaining", until: endsAt }} /></ExpandedValue>
          </ExpandedSide>
        ),
      },
    }),
    [endsAt, controls],
  );
  return null;
};
```

`TickingTime` updates its own text every second, with digits that turn over, so the activity is built once. A four-character time is wider than the split capsule's room (about 20 pt), so a timer that may land in the capsule is cut there; give the timer a higher `priority` when it should keep the pill. When it reaches zero, call `controls.alert()` (from `useActivity`'s return) and end it after the user acknowledges. Preset: `timer-activity`.

## Stages (food order, build, onboarding, a delivery's legs)

Work that moves through named steps. Compact: the stage's glyph and the minutes or step count; the capsule gets a form that fits. Expanded, label-led: the source beside the sensor, a status caption on the right, the stage as the title with its detail under it, and one segment per step at the foot. A new stage is a crossfade; a stage the user must see (out for delivery, failed) is an alert.

```tsx
"use client";

import { Glyph } from "@/components/islandcn/glyph";
import { CheckCircleGlyph, PackageGlyph } from "@/components/islandcn/glyphs";
import { BottomBar, ExpandedBottom, SensorRow } from "@/components/islandcn/island-layout";
import { BubbleForm, Caption, CompactText, ContextLabel, ExpandedSubtitle, ExpandedTitle, MinimalPair, NumberText } from "@/components/islandcn/island-text";
import { StepProgress, stepsAt } from "@/components/islandcn/step-progress";
import { islandAccent } from "@/components/islandcn/theme";
import { useActivity } from "@/components/islandcn/use-activity";

const stages = [
  { title: "Order received", detail: "The kitchen has it" },
  { title: "Preparing your order", detail: "2 bowls, 1 side" },
  { title: "Out for delivery", detail: "Sam is on the way" },
  { title: "Delivered", detail: "Left at the door" },
] as const;

interface OrderIslandProps {
  /** Index into `stages`, 0 to 3. */
  stage: number;
  /** Minutes until it arrives. */
  minutes: number;
  /** Arrival time as the user reads it, such as "7:42". */
  arrives: string;
}

export const OrderIsland = ({ stage, minutes, arrives }: OrderIslandProps) => {
  const done = stage >= stages.length - 1;
  const current = stages[Math.min(stage, stages.length - 1)] ?? stages[0];
  const accent = done ? islandAccent.green : islandAccent.orange;
  const glyph = done ? CheckCircleGlyph : PackageGlyph;
  useActivity(
    () => ({
      id: "order",
      label: done ? "Order delivered" : `${current.title}, ${minutes} minutes`,
      compact: {
        leading: <Glyph icon={glyph} color={accent} />,
        // "18 min" in the pill; the capsule's 20 pt holds "18".
        trailing: done ? (
          <CompactText color={accent}>Here</CompactText>
        ) : (
          <BubbleForm bubble={<CompactText color={accent}><NumberText value={minutes} /></CompactText>}>
            <CompactText color={accent}><NumberText value={minutes} /> min</CompactText>
          </BubbleForm>
        ),
      },
      minimal: <MinimalPair leading={<Glyph icon={glyph} color={accent} />} trailing={<CompactText color={accent}>{done ? "Here" : `${minutes}m`}</CompactText>} />,
      expanded: {
        // The label beside the sensor holds eight or nine characters: a short word, not its full one.
        leading: (
          <SensorRow glyph={<Glyph icon={glyph} color={accent} size={18} />}>
            <ContextLabel>Order</ContextLabel>
          </SensorRow>
        ),
        trailing: (
          <SensorRow align="end">
            <Caption>{done ? arrives : `Arrives ${arrives}`}</Caption>
          </SensorRow>
        ),
        bottom: (
          <ExpandedBottom gap={4}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
              <ExpandedTitle>{current.title}</ExpandedTitle>
              {done ? null : <ExpandedTitle color={accent} style={{ flex: "none" }}><NumberText value={minutes} /> min</ExpandedTitle>}
            </div>
            <ExpandedSubtitle>{current.detail}</ExpandedSubtitle>
            <BottomBar>
              <StepProgress steps={stepsAt({ total: stages.length, current: done ? stages.length : stage })} color={accent} label={current.title} />
            </BottomBar>
          </ExpandedBottom>
        ),
      },
    }),
    [stage, minutes, arrives],
  );
  return null;
};
```

To alert on the stages that matter, keep `useActivity`'s return (`const controls = useActivity(...)`) and call `controls.alert()` in an effect on `stage`, or pass `alert: true` in the build for those stages. A build is the same shape: `TerminalGlyph`, "3/5" in the pill with a `ProgressRing` in the capsule, `stepsAt({ total, current, failed })` turning the failed step red, and `IslandButton`s (Re-run, View logs) in `<ExpandedBottom reach="action">` once it fails.

## Two sides (a game score, a route, a trade)

Two parties of equal weight. Compact puts one on each side of the sensor, mark and value; the capsule shows the leader's mark only. Expanded mirrors them: each side's crest and score in an `ExpandedSide`, what joins them (the period and clock) in `center`, one line of news in `bottom`.

```tsx
"use client";

import { Avatar } from "@/components/islandcn/avatar";
import { ExpandedBottom, ExpandedSide } from "@/components/islandcn/island-layout";
import { Caption, CompactText, ExpandedValue, MinimalPair, NumberText, withBubble } from "@/components/islandcn/island-text";
import { islandAccent, islandInk } from "@/components/islandcn/theme";
import { useActivity } from "@/components/islandcn/use-activity";

interface Team {
  name: string;
  /** Crest image URL; without it the avatar shows the team's initials. */
  crest?: string;
  score: number;
}

interface ScoreIslandProps {
  home: Team;
  away: Team;
  /** Period and clock, such as "Q4 2:31". */
  clock: string;
  /** The last play, such as "Okafor makes a 3-point jump shot". */
  play: string;
}

const Side = ({ team, mirror, size }: { team: Team; mirror: boolean; size: number }) => (
  <span style={{ display: "flex", alignItems: "center", gap: size > 30 ? 10 : 6, flexDirection: mirror ? "row-reverse" : "row" }}>
    <Avatar name={team.name} src={team.crest} size={size} />
    {size > 30 ? (
      <ExpandedValue><NumberText value={team.score} /></ExpandedValue>
    ) : (
      <CompactText><NumberText value={team.score} /></CompactText>
    )}
  </span>
);

export const ScoreIsland = ({ home, away, clock, play }: ScoreIslandProps) => {
  const leader = home.score >= away.score ? home : away;
  const crest = <Avatar name={leader.name} src={leader.crest} />;
  useActivity(
    () => ({
      id: "score",
      label: `${home.name} ${home.score}, ${away.name} ${away.score}, ${clock}`,
      compact: withBubble({ leading: <Side team={home} mirror={false} size={22} />, trailing: <Side team={away} mirror size={22} /> }, crest),
      minimal: <MinimalPair leading={crest} trailing={<CompactText><NumberText value={`${home.score}-${away.score}`} /></CompactText>} />,
      expanded: {
        leading: (
          <ExpandedSide height={52}>
            <Side team={home} mirror={false} size={40} />
          </ExpandedSide>
        ),
        center: (
          <div style={{ display: "grid", justifyItems: "center" }}>
            <Caption color={islandAccent.red}>LIVE</Caption>
            <CompactText><NumberText value={clock} /></CompactText>
          </div>
        ),
        trailing: (
          <ExpandedSide height={52} align="end">
            <Side team={away} mirror size={40} />
          </ExpandedSide>
        ),
        // One full-width line of text: "lift" raises it clear of the bottom corners.
        bottom: (
          <ExpandedBottom reach="lift">
            <Caption color={islandInk.secondary} style={{ textAlign: "center" }}>{play}</Caption>
          </ExpandedBottom>
        ),
      },
    }),
    [home.score, away.score, home.crest, away.crest, clock, play],
  );
  return null;
};
```

A score that changes is an `update` (the digits turn over); a score that matters (a goal, the lead changes hands) is an alert with the play in white. A route is the same layout with the two codes as the big values and a dashed line with a glyph between them.

## Readings (a workout, a flight's details, a device)

Several numbers at once. Compact shows the one a glance needs (the heart rate, the gate). Expanded: a label-led top row with the elapsed time, then two to four readings in a `MetricRow`, and a `Sparkline` when the trend matters.

```tsx
"use client";

import { WorkoutRunIcon } from "@hugeicons/core-free-icons";

import { Glyph } from "@/components/islandcn/glyph";
import { glyphFrom, HeartGlyph } from "@/components/islandcn/glyphs";
import { ExpandedBottom, SensorRow } from "@/components/islandcn/island-layout";
import { CompactText, ContextLabel, MinimalPair, NumberText, withBubble } from "@/components/islandcn/island-text";
import { MetricRow } from "@/components/islandcn/metric";
import { Sparkline } from "@/components/islandcn/sparkline";
import { islandAccent } from "@/components/islandcn/theme";
import { TickingTime } from "@/components/islandcn/ticking-time";
import { useActivity } from "@/components/islandcn/use-activity";

// The glyph set has no runner, so one comes from Hugeicons' free set, drawn at the island's weight.
const RunnerGlyph = glyphFrom("RunnerGlyph", WorkoutRunIcon);

interface RunIslandProps {
  /** When the run started, epoch ms. */
  since: number;
  /** Beats per minute now. */
  heart: number;
  /** The last few minutes of heart rate, oldest first. */
  heartHistory: readonly number[];
  /** Pace per kilometre, such as "5′12″". */
  pace: string;
  /** Kilometres so far. */
  km: number;
}

export const RunIsland = ({ since, heart, heartHistory, pace, km }: RunIslandProps) => {
  const green = islandAccent.green;
  const red = islandAccent.red;
  const runner = <Glyph icon={RunnerGlyph} color={green} />;
  useActivity(
    () => ({
      id: "run",
      label: `Outdoor run, ${km.toFixed(2)} kilometres, heart rate ${heart}`,
      // "♥148" is wider than the capsule's room: there the runner shows alone.
      compact: withBubble(
        {
          leading: runner,
          trailing: (
            <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <Glyph icon={HeartGlyph} color={red} size={13} />
              <CompactText color={red}><NumberText value={heart} /></CompactText>
            </span>
          ),
        },
        runner,
      ),
      minimal: <MinimalPair leading={runner} trailing={<CompactText color={red}>{heart}</CompactText>} />,
      expanded: {
        leading: (
          <SensorRow glyph={<Glyph icon={RunnerGlyph} color={green} size={18} />}>
            <ContextLabel>Run</ContextLabel>
          </SensorRow>
        ),
        trailing: (
          <SensorRow align="end">
            <CompactText color={green}><TickingTime source={{ kind: "elapsed", since }} /></CompactText>
          </SensorRow>
        ),
        bottom: (
          <ExpandedBottom reach="inset" gap={10}>
            <MetricRow
              metrics={[
                { label: "Heart rate", value: <NumberText value={heart} />, unit: "BPM", color: red },
                { label: "Pace", value: pace, unit: "/km" },
                { label: "Distance", value: <NumberText value={km.toFixed(2)} />, unit: "km" },
              ]}
            />
            <Sparkline values={heartHistory} color={red} height={22} strokeWidth={1.75} label="Heart rate over the last minutes" />
          </ExpandedBottom>
        ),
      },
    }),
    [since, heart, heartHistory, pace, km],
  );
  return null;
};
```

## A price (stock, crypto, a bid)

Compact: a 30 pt `Sparkline` leading and the change trailing, green up and red down; the capsule shows a glyph or the sparkline alone. Expanded, label-led: the name beside the sensor and the change on the right, then the price as the big value and a full-width `<Sparkline area baseline={open} height={34} />` under it in `<ExpandedBottom reach="inset">`. Write a fall with a minus sign (U+2212), not a hyphen. Crossing a level the user watches is an alert; every tick is an `update`.

## A code that expires (sign-in code, a hold, a reservation)

Start with `alert: true` so the code shows the moment it arrives. Compact: a lock glyph and the code ("482 913" fits the 72 pt slot); the capsule shows a `CountdownRing` instead, through `withBubble`. Expanded, label-led: the service beside the sensor, the seconds left (`TickingTime` with a format of `` (ms) => `${Math.ceil(ms / 1000)}s` ``) and an 18 pt `CountdownRing` on the right, then the code large with a Copy `IslandButton` (`fill={false}`, `size="compact"`) on the same row in `<ExpandedBottom reach="action">`. `CountdownRing` and `TickingTime` move by themselves, so the activity is built once; end it from `CountdownRing`'s `onEnd`.

```tsx
"use client";

import { CountdownRing } from "@/components/islandcn/countdown-ring";
import { CompactText, withBubble } from "@/components/islandcn/island-text";
import { islandAccent } from "@/components/islandcn/theme";

/** The compact pair: the code in the pill, the ring alone in the split capsule. */
export const codeCompact = (code: string, issued: number, expires: number) =>
  withBubble(
    { leading: <CountdownRing start={issued} end={expires} color={islandAccent.blue} size={22} />, trailing: <CompactText>{code}</CompactText> },
    <CountdownRing start={issued} end={expires} color={islandAccent.blue} />,
  );
```

## A transcript (live captions, translation, an agent's output)

Compact: the task's glyph and a `LevelMeter` (it fits the capsule as it is). Expanded: a label-led top row ("English to Spanish", the elapsed time and a small meter), then `<TailText>` lines in `<ExpandedBottom reach="lift">`: the source at 15 pt regular grey, the result at 17 pt semibold white. `TailText` keeps the newest words in view and fades the start once the line is longer than the island; update the text as words arrive (a few times a second is fine).

## Approval (agent asks, payment confirm, destructive action)

Keep the island open until the user answers: start or update the content, then `island.expand(id)`. An alert would fold back by itself.

```tsx
"use client";

import { Glyph } from "@/components/islandcn/glyph";
import { WarningGlyph } from "@/components/islandcn/glyphs";
import { IslandButton } from "@/components/islandcn/island-button";
import { ExpandedBottom, SensorRow } from "@/components/islandcn/island-layout";
import { CompactText, ContextLabel, TitleStack } from "@/components/islandcn/island-text";
import { islandAccent } from "@/components/islandcn/theme";
import { useIsland } from "@/lib/island";

export const useConfirm = () => {
  const island = useIsland();

  const ask = (title: string) =>
    new Promise<boolean>((resolve) => {
      const answer = (ok: boolean) => {
        resolve(ok);
        island.collapse();
      };
      island.start({
        id: "confirm",
        label: `Needs approval: ${title}`,
        compact: { leading: <Glyph icon={WarningGlyph} color={islandAccent.orange} />, trailing: <CompactText color={islandAccent.orange}>Approve?</CompactText> },
        expanded: {
          leading: (
            <SensorRow glyph={<Glyph icon={WarningGlyph} color={islandAccent.orange} size={18} />}>
              <ContextLabel>Needs approval</ContextLabel>
            </SensorRow>
          ),
          // The question and the answers under the label, full width; "action" lines the 44 pt buttons up with the corners.
          bottom: (
            <ExpandedBottom reach="action" gap={12}>
              <TitleStack title={title} subtitle="Waiting for you" />
              <div style={{ display: "flex", gap: 10 }}>
                <IslandButton onPress={() => answer(false)}>Deny</IslandButton>
                <IslandButton tone={{ kind: "accent", color: islandAccent.lagoon }} onPress={() => answer(true)}>Approve</IslandButton>
              </div>
            </ExpandedBottom>
          ),
        },
        onPress: () => island.expand("confirm"),
      });
      island.expand("confirm");
    });

  return ask;
};
```

If the user collapses it, compact still says "Approve?" and a tap brings it back.

## Incoming call (or anything that rings)

- Start with `priority: 2`, then `island.expand(id)` while it rings: avatar leading, caller and subtitle center, round decline (red) and accept (green) buttons trailing. Wrap the avatar and the buttons in `<ExpandedSide>` (default height `islandRow.titleStack`) so they sit level with the caller's name on the top-aligned row.
- On accept, update to the active state: phone glyph and `<TickingTime source={{ kind: "elapsed", since }} />` in compact, and collapse.
- Preset: `call-activity`.

## A one-off notice

There is no notification preset. For a short notice, start an activity with `expanded` content and `priority: 2`, call `island.expand(id)`, and end it after a few seconds with `handle.end()`.

## Two at once (the split)

Nothing to call: start a second activity and the island splits. On the reference phone each shape shows its activity's compact pair, so write `compact` to work in the capsule too: its trailing room is about 20 pt (one or two digits, a short meter, a 20 pt ring). When the trailing value is wider than that ("4:31", "18 min", "B32"), wrap the compact pair in `withBubble(compact, bubble)` or one slot in `<BubbleForm bubble={...}>` so the capsule shows a form that fits (a ring, the glyph, two digits) instead of an ellipsis. Set `priority` so the more urgent one keeps the attached pill. Give each a `minimal` too, the fallback when both pairs together are wider than 290. Holding either shape expands that activity. Demo: `split-demo`.

## One source, many activities (groups)

When activities come from the same place and only the latest matters (orders from one shop, runs of one agent, sessions of one workout), give them the same `group` so they take turns instead of splitting:

```tsx
"use client";

import { CompactText, ExpandedTitle } from "@/components/islandcn/island-text";
import { useIslandActions } from "@/lib/island";

export const useOrderIsland = () => {
  const island = useIslandActions();

  const show = (order: { id: string; eta: string }) =>
    island.start({ id: `order-${order.id}`, group: "orders", label: `Order ${order.id}`, compact: { trailing: <CompactText>{order.eta}</CompactText> } });

  // Later: hands the island over to this order. The shown one leaves to idle, the island waits
  // about 1.5 s, then this one expands with its update and settles to compact.
  const outForDelivery = (order: { id: string }) =>
    island.update(`order-${order.id}`, { alert: true, expanded: { center: <ExpandedTitle>Out for delivery</ExpandedTitle> } });

  return { show, outForDelivery };
};
```

`island.expand(id)` brings a hidden one forward at once (for a list where the user picks one). Don't group unrelated tasks: a timer and music should split.

## Status that comes and goes (battery, connection, sync done)

Mount the activity for a few seconds when the state changes, with `alert: true` on start, then unmount it. A status that sits in the island all day is noise. Preset: `battery-activity`.
