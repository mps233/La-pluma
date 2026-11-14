"use client";

/* eslint-disable react-hooks/set-state-in-effect -- islandcn preset code: the activity is started from a mount effect and the fill-in time is read from performance.now(). */


import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from "react";

import { islandMetrics, useIslandActions, useIslandReducedMotion } from "@/lib/island/index";

import { IslandStyle } from "./island-style";
import { Caption, CompactText, MinimalPair, NumberText, withBubble } from "./island-text";
import { islandAccent, islandInk, islandLine } from "./theme";

import { useActivity, useLatest } from "./use-activity";

/**
 * Apple's charging pill, measured on its marketing crop at 4.39 px to the pt (the pill's 161.8 px
 * height over the engine's 36.85 pt compact height). The pill is 317 x 36.85 pt. "Charging" is 15 pt
 * semibold white (cap height 10.5 pt, stems 1.6 pt: 0.107 of the size, as the semibold caller name on
 * a phone's incoming call measures 0.103 and its regular grey line 0.083), its left edge 14.46 pt
 * from the pill's end. On the right, "75%" at the same size and weight in green, a 5.7 pt gap, then
 * a 35.5 x 16.6 pt battery whose nub ends 10.1 pt from the pill's end. Text and battery sit 0.5 to
 * 0.7 pt above the pill's middle.
 */
const measured = {
  /** The C's side bearing at 15 pt: its box starts this far before its ink. */
  bearing: 0.76,
  /** The label's box: 14.46 to the C's ink, less the C's side bearing. */
  labelInset: 13.7,
  glyphInset: 10.1,
  gap: 5.7,
  glyph: 35.5,
} as const satisfies Record<string, number>;

/**
 * The compact pill. Two 72 pt slots (the engine's widest) and the sensor make it 253 pt wide, 64 pt
 * short of Apple's 317, so the insets give way before the text does.
 */
const pill = {
  /** Each side's width: the engine's widest compact slot. */
  side: islandMetrics.compact.maxSlotWidth,
  /** Extra inset before the label, past the engine's edge padding: its ink 14.5 pt from the pill's end. */
  labelInset: measured.labelInset - islandMetrics.compact.edgePadding,
  /** Extra inset after the battery's nub. Apple's is 2.9 past the edge padding; 2 leaves the battery its width in a 72 pt slot. */
  glyphInset: 2,
  /** Between the percentage and the battery. Apple's is 5.7 pt; 4 leaves the battery its full width. */
  gap: 4,
  /** Beside "100%", whose extra digit would push the percentage out of the slot. */
  glyphFull: 27,
  /**
   * Narrowest the battery gets when the percentage runs wide. With the system font the semibold
   * "75%" is about 30 pt and everything fits; a fallback font's wider figures (34 pt) narrow the
   * battery first, so the gap and the end inset hold.
   */
  glyphMin: 22,
} as const satisfies Record<string, number>;

const expanded = islandMetrics.expanded;

/**
 * The expanded view: the same row with one quiet line under the label, since the engine always opens
 * the full-width island and its shortest is 374.34 x 84 pt. The row's frame is the content height
 * that keeps the island at that minimum, with both sides centred in it, so the island stays as short
 * as the engine allows and the row sits on its middle.
 *
 * Both ends sit on the engine's expanded padding, 18.5 pt in, not the pill's 14.5: the engine clips
 * content to a capsule 13.5 pt in from the island's edge (its 47.9 corner less the 34.4 clip corner),
 * and two lines reach far enough above and below the middle that the clip's curve is 16 to 17 pt in
 * there, which would cut the label's and the grey line's first letters.
 */
const row = {
  height: expanded.minHeight - expanded.padding.top - expanded.padding.bottom,
  /** How far the label's box moves out past the leading padding (negative is toward the edge): its ink starts on the padding. */
  labelShift: -measured.bearing,
  /** How far the battery moves in past the trailing padding: its nub ends 18.5 pt in, mirroring the label. */
  glyphShift: expanded.padding.side - (expanded.padding.trailing ?? expanded.padding.side),
  /**
   * Widest the label and its line get: half the island less the sensor's half, the padding and a
   * 6 pt gap, so a long device name ends in an ellipsis before it runs under the sensor.
   */
  labelWidth: (islandMetrics.screen.width - 2 * expanded.sideInset - islandMetrics.idle.width) / 2 - expanded.padding.side - 6,
} as const satisfies Record<string, number>;

/** The battery before the label beside the sensor, in pt: a little under the compact one, as a label's icon. */
export const labelBatteryWidth = 26;

/** One side of the compact pill: always the slot's full width, so the pill keeps the charging indicator's breadth. */
const sideBox: CSSProperties = { display: "flex", alignItems: "center", width: pill.side, minWidth: 0 };
/**
 * Space that gives way before the text does: the label or the percentage only shrinks once its
 * inset is gone, so a long device name loses its inset first and its letters last.
 */
const give = (basis: number): CSSProperties => ({ flex: `0 1000 ${basis}px`, minWidth: 0 });
/** Space that gives way only after the battery has narrowed to its least. */
const hold = (basis: number): CSSProperties => ({ flex: `0 1 ${basis}px`, minWidth: 0 });

/** One side of the expanded row: its frame, the content centred in it and moved out by `shift`. */
const rowSide = (align: "start" | "end", shift: number): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  justifyContent: align === "end" ? "flex-end" : "flex-start",
  height: row.height,
  position: "relative",
  [align === "end" ? "right" : "left"]: shift,
});

export interface BatteryActivityProps {
  /** Activity id. Defaults to "battery". */
  id?: string;
  /** Higher priority takes the main pill when two activities run. Defaults to 0. */
  priority?: number;
  /** Charge from 0 to 1. */
  level: number;
  /** Plugged in and charging. */
  charging: boolean;
  /**
   * Time until full in ms. The compact pill shows no time; the expanded view shows "Full in 55 min"
   * under the label while charging below full, and screen readers hear it. Defaults to none.
   */
  timeToFull?: number;
  /** Below this the battery turns red. Defaults to 0.2. */
  lowThreshold?: number;
  /**
   * Device name, such as "Headphones": the label when it isn't charging, the line under the expanded
   * label while charging with no `timeToFull` (or once full), and what screen readers hear. Defaults to "Battery".
   */
  name?: string;
  /**
   * Expand briefly when it appears. The system's charging indicator never does: plugging in shows
   * the compact pill only. Defaults to false.
   */
  alertOnStart?: boolean;
  /**
   * Leave the island this many ms after appearing, and come back for the same time each time
   * `charging` turns on, as the system's charging indicator shows for a moment when you plug in and
   * goes (`chargingIndicatorHold`, 3.3 s, is its length). While the island is open it waits, then
   * leaves a beat after it closes. Defaults to none: it stays while mounted, as a status.
   */
  dismissAfter?: number;
  /** Called when it leaves by itself after `dismissAfter`. Defaults to none. */
  onDismiss?: () => void;
}

/**
 * How long the system's charging indicator stays up after you plug in, in ms: the pill opens, the
 * battery fills to the level by 1.3 s, and it holds two more before it goes.
 */
export const chargingIndicatorHold = 3300;

/** The percentage's green while charging, measured on the charging pill's "75%". */
export const chargingGreen = "#53fa6d";

/**
 * The charging fill, sampled across the charging pill's battery on its middle row: a mint at the
 * fill's left end turning to lime by its right end (its blue falls fastest early on), and a deep
 * green where it is empty and on the nub.
 */
const chargeFill = { from: "#5afeb6", mid: "#62fd6b", to: "#63ff39", empty: "#2e7124" } as const;

/**
 * The fill-in on appear: the charge grows from empty to the level once the pill has opened, as the
 * charging indicator's battery fills when you plug in. It waits `fillIn.delay` for the pill's
 * content to come out of its blur, then sweeps for `fillIn.duration` on an ease in and out: a
 * strong ease-out put the whole sweep in the first 200 ms, still under the blur, so it went unseen.
 */
const fillIn = { delay: 300, duration: 1000 } as const satisfies Record<string, number>;

const fillCss = `
.icn-battery-fill { transition: transform 600ms cubic-bezier(0.22, 1, 0.36, 1); transform-box: fill-box; transform-origin: 0 50%; }
@keyframes icn-battery-fill-in { from { transform: scaleX(0.06); } }
.icn-battery-fill-in { animation: icn-battery-fill-in ${fillIn.duration}ms cubic-bezier(0.45, 0, 0.25, 1) both; }
@media (prefers-reduced-motion: reduce) { .icn-battery-fill, .icn-battery-fill-in { transition: none; animation: none; } }
`;

/** The clock appearances are timed on: `performance.now()`, which page and island share. */
const now = () => performance.now();

/**
 * The charge, filling in from empty when it first draws. Every copy of the battery (the compact pill,
 * the expanded row, the split) times its fill-in from the same moment, `since`, so a view that mounts
 * partway (a long press during the fill) joins it where it is, and one that mounts later shows the
 * level at once. Keyed by `since` where it is used, so plugging in again plays it again.
 */
interface ChargeFillProps {
  /** When the pill appeared (`performance.now()`), or undefined to draw the level at once. Required. */
  since: number | undefined;
  /** The charge, 0 to 1, as the fill's horizontal scale. Required. */
  scale: number;
  /** Whether level changes and the fill-in animate (false under reduced motion). Required. */
  animate: boolean;
  /** The fill's shapes. Required. */
  children: ReactNode;
}

const ChargeFill = ({ since, scale, animate, children }: ChargeFillProps) => {
  // Measured once when this copy mounts: a later render must not move the animation's clock.
  const [delay] = useState(() => (since === undefined ? 0 : fillIn.delay - (now() - since)));
  const filling = animate && since !== undefined && delay > -fillIn.duration;
  return (
    <g
      className={[animate ? "icn-battery-fill" : "", filling ? "icn-battery-fill-in" : ""].filter(Boolean).join(" ") || undefined}
      style={{ transform: `scaleX(${scale})`, transformBox: "fill-box", transformOrigin: "0 50%", ...(filling ? { animationDelay: `${Math.round(delay)}ms` } : {}) }}
    >
      {children}
    </g>
  );
};

/**
 * The battery drawn as the charging indicator draws it, one SVG: a solid rounded body with no
 * outline, the charge in the accent from the left end, the empty part and the nub in the accent
 * dimmed, and no bolt. Proportions from Apple's: 36.1 wide in all, a 33 x 17 body with a 5 corner,
 * a 1.2 gap, then a 1.9 x 5.8 nub. While charging the fill runs mint to lime, as Apple's does.
 */
export const BatteryGlyph = ({ level, color, charging = false, width = 27, outline, fluid = false, fillSince }: {
  /** Charge from 0 to 1. */
  level: number;
  /** Fill colour. */
  color: string;
  /** Fills mint to lime with a deep green empty part, as the charging indicator does. Defaults to false. */
  charging?: boolean;
  /** Width in pt, including the nub. The height follows. Defaults to 27. */
  width?: number;
  /** Colour of the empty part and the nub. Defaults to the fill colour at 42%, or the deep green while charging. */
  outline?: string;
  /** Fills its box's width, at most `width`, keeping its proportions, so a row that runs short can narrow it. Defaults to false. */
  fluid?: boolean;
  /**
   * When the battery appeared, from `performance.now()`: the charge fills in from empty over about a
   * second from then, as the charging indicator's does when you plug in (none with reduced motion).
   * Defaults to none: the level shows at once.
   */
  fillSince?: number;
}) => {
  const reduced = useIslandReducedMotion();
  const id = `icn-bat${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const scale = width / 36.1;
  const nub = { w: 1.9 * scale, h: 5.8 * scale, gap: 1.2 * scale };
  const body = { w: width - nub.w - nub.gap, h: 17 * scale };
  const radius = 5 * scale;
  const value = Math.min(1, Math.max(0, level));
  const empty = outline ?? (charging ? chargeFill.empty : withAlpha(color, 0.42));
  return (
    <span aria-hidden style={fluid ? { display: "block", width: "100%", maxWidth: width, aspectRatio: `${width} / ${body.h}` } : { display: "block", width, height: body.h, flex: "none" }}>
      <IslandStyle id="battery" css={fillCss} />
      <svg width={fluid ? "100%" : width} height={fluid ? "100%" : body.h} viewBox={`0 0 ${width} ${body.h}`} style={{ display: "block", overflow: "visible" }}>
        <defs>
          <clipPath id={`${id}-body`}>
            <rect width={body.w} height={body.h} rx={radius} />
          </clipPath>
          {charging ? (
            // Across the fill, not the body: the lime always reaches the fill's end, as on Apple's.
            <linearGradient id={`${id}-sheen`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor={chargeFill.from} />
              <stop offset="0.5" stopColor={chargeFill.mid} />
              <stop offset="1" stopColor={chargeFill.to} />
            </linearGradient>
          ) : null}
        </defs>
        <g clipPath={`url(#${id}-body)`}>
          <rect width={body.w} height={body.h} fill={empty} />
          <ChargeFill key={fillSince ?? "still"} since={fillSince} scale={Math.max(0.06, value)} animate={!reduced}>
            <rect width={body.w} height={body.h} fill={charging ? `url(#${id}-sheen)` : color} />
          </ChargeFill>
        </g>
        <rect x={body.w + nub.gap} y={(body.h - nub.h) / 2} width={nub.w} height={nub.h} rx={nub.w / 2} fill={empty} />
      </svg>
    </span>
  );
};

/** A #rrggbb colour at an alpha; other colour forms come back as they are. */
const withAlpha = (color: string, alpha: number): string => {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match?.[1]) return color;
  const value = Number.parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
};

/**
 * The label's type: the kit's 15 pt semibold, as "Charging" measures (stems 0.107 of the size). An
 * earlier regular weight read thin and grey beside the green, a status line, not the indicator.
 */
const labelStyle: CSSProperties = { flex: "0 1 auto", minWidth: 0 };
/** The line under the expanded label: the kit's 13 pt caption, regular to match the label's weight, so it stays quiet. */
const detailStyle: CSSProperties = { minWidth: 0, maxWidth: "100%", fontWeight: 400 };

/**
 * The percentage as the charging pill sets "75%": semibold figures, as heavy as the label, the sign
 * at their size and weight. While charging it takes the measured green, as the battery's fill takes
 * its own colours.
 */
const ChargingPercent = ({ level, color, charging }: { level: number; color: string; charging: boolean }) => (
  <span style={{ flex: "none" }}>
    <CompactText color={charging ? chargingGreen : color}>
      <NumberText value={Math.round(level * 100)} motion="steady" />%
    </CompactText>
  </span>
);

/**
 * The charging pill's leading side: the label in white, its ink 14.5 pt in from the pill's end, in a box as
 * wide as the engine's widest slot, so the pill keeps the charging indicator's breadth.
 */
export const ChargingLabel = ({ children, color = islandInk.primary }: {
  /** The label, such as "Charging". */
  children: ReactNode;
  /** Its colour. Defaults to white, as the charging indicator's. */
  color?: string;
}) => (
  <span style={sideBox}>
    <span aria-hidden style={give(pill.labelInset)} />
    <CompactText color={color} style={labelStyle}>{children}</CompactText>
  </span>
);

/**
 * The charging pill's trailing side: the percentage, then a 35.5 pt battery ending 9.2 pt from the
 * pill's end, in a box as wide as the engine's widest slot.
 */
export const ChargingLevel = ({ level, color, charging = false, fillSince }: {
  /** Charge from 0 to 1. */
  level: number;
  /** The percentage's and the battery's colour. While charging the percentage is the charging green and the battery fills mint to lime. */
  color: string;
  /** Plugged in: the charging colours. Defaults to false. */
  charging?: boolean;
  /** When it appeared (`performance.now()`), so the battery fills in from then. Defaults to none: the level shows at once. */
  fillSince?: number;
}) => {
  const value = Math.min(1, Math.max(0, level));
  const glyphWidth = Math.round(value * 100) >= 100 ? pill.glyphFull : measured.glyph;
  return (
    <span style={{ ...sideBox, justifyContent: "flex-end" }}>
      <ChargingPercent level={value} color={color} charging={charging} />
      <span aria-hidden style={hold(pill.gap)} />
      <span style={{ display: "flex", alignItems: "center", flex: `0 100 ${glyphWidth}px`, minWidth: pill.glyphMin }}>
        <BatteryGlyph level={value} color={color} charging={charging} width={glyphWidth} fluid fillSince={fillSince} />
      </span>
      <span aria-hidden style={hold(pill.glyphInset)} />
    </span>
  );
};

export interface ChargingRowLabelProps {
  /** The label, such as "Charging". Required, no default. */
  children: ReactNode;
  /** A quiet line under it in secondary grey, such as "Full in 55 min". Defaults to none: the label alone on the island's middle. */
  detail?: ReactNode;
  /** The label's colour. Defaults to white, as the charging indicator's. */
  color?: string;
}

/**
 * The expanded row's leading side: the label and, when given, a grey line under it, the two
 * centred together on the shortest island's middle with their ink on the engine's 18.5 pt padding.
 */
export const ChargingRowLabel = ({ children, detail, color = islandInk.primary }: ChargingRowLabelProps) => (
  <div
    style={{
      ...rowSide("start", row.labelShift),
      flexDirection: "column",
      alignItems: "flex-start",
      justifyContent: "center",
      gap: islandLine.stackGap,
      maxWidth: row.labelWidth,
    }}
  >
    <CompactText color={color} style={{ ...labelStyle, maxWidth: "100%" }}>{children}</CompactText>
    {detail === undefined || detail === null || detail === "" ? null : <Caption style={detailStyle}>{detail}</Caption>}
  </div>
);

export interface ChargingRowLevelProps {
  /** Charge from 0 to 1. Required, no default. */
  level: number;
  /** The percentage's and the battery's colour. Required, no default. While charging the percentage is the charging green and the battery fills mint to lime instead. */
  color: string;
  /** Plugged in: the charging colours. Defaults to false. */
  charging?: boolean;
  /** When it appeared (`performance.now()`), so the battery fills in from then. Defaults to none: the level shows at once. */
  fillSince?: number;
}

/**
 * The expanded row's trailing side: the percentage, a 5.7 pt gap and the 35.5 pt battery, centred on
 * the island's middle, the nub 18.5 pt from the island's end. Here the full battery fits beside "100%".
 */
export const ChargingRowLevel = ({ level, color, charging = false, fillSince }: ChargingRowLevelProps) => {
  const value = Math.min(1, Math.max(0, level));
  return (
    <div style={{ ...rowSide("end", row.glyphShift), gap: measured.gap }}>
      <ChargingPercent level={value} color={color} charging={charging} />
      <BatteryGlyph level={value} color={color} charging={charging} width={measured.glyph} fillSince={fillSince} />
    </div>
  );
};

/** The name the preset uses when none is given. */
const defaultName = "Battery";

/**
 * The quiet line under the expanded label: the one fact the row doesn't already show. While charging
 * that is the time to full, else the device's name (the label says "Charging" there, not the name).
 * Unplugged, the label is the name, so the line gives the state. A default-named battery that is
 * charging with no `timeToFull`, or is full ("Charged" already says it), has nothing true to add, so
 * it shows the label alone rather than repeat it.
 */
const detailFor = ({ value, charging, low, name, minutesToFull }: {
  value: number;
  charging: boolean;
  low: boolean;
  name: string;
  minutesToFull: number | null;
}): string | undefined => {
  if (!charging) return low ? "Low battery" : "Not charging";
  if (value < 1 && minutesToFull !== null) return `Full in ${formatMinutes(minutesToFull)}`;
  return name !== defaultName ? name : undefined;
};

/**
 * Battery and charging, as the system's charging indicator shows it: one row, "Charging" in white
 * on the left, and the percentage and a battery in green on the right, the battery filling in as it
 * appears. Compact draws it as wide as the engine allows; a long press or an alert opens the same
 * row in the shortest expanded island, with one grey line under the label (the time to full while
 * charging). With `dismissAfter` it shows for a moment and goes, coming back each time you plug in.
 */
export const BatteryActivity = ({ charging, dismissAfter, onDismiss, ...rest }: BatteryActivityProps) => {
  const island = useIslandActions();
  // When the pill last appeared: on mount, and again each time it is plugged in. Null once it left.
  const [shownAt, setShownAt] = useState<number | null>(now);
  const wasCharging = useRef(charging);
  useEffect(() => {
    if (charging && !wasCharging.current) setShownAt(now());
    wasCharging.current = charging;
  }, [charging]);

  const dismissed = useLatest(onDismiss);
  useEffect(() => {
    if (shownAt === null || dismissAfter === undefined) return;
    let timer = 0;
    const leave = () => {
      // Open (a long press or an alert): wait, and leave a beat after it closes rather than from under a
      // finger. The engine doesn't say which activity is open (`expand(id)` can open one that isn't
      // first), so any open island waits: leaving late is harmless, removing an open view is not.
      if (island.presentation === "expanded") {
        timer = window.setTimeout(leave, 300);
        return;
      }
      setShownAt(null);
      dismissed.current?.();
    };
    timer = window.setTimeout(leave, Math.max(0, shownAt + dismissAfter - now()));
    return () => window.clearTimeout(timer);
  }, [shownAt, dismissAfter, island, dismissed]);

  return shownAt === null ? null : <ChargingIndicator {...rest} charging={charging} shownAt={shownAt} />;
};

interface ChargingIndicatorProps extends Omit<BatteryActivityProps, "dismissAfter" | "onDismiss"> {
  /** When this showing of the pill began (`performance.now()`), so every copy of the battery fills in from it. Required. */
  shownAt: number;
}

/** The activity itself, mounted while the pill is up: mounting starts it, unmounting ends it with the dismiss motion. */
const ChargingIndicator = ({
  id = "battery", priority = 0,
  level,
  charging,
  timeToFull,
  lowThreshold = 0.2,
  name = defaultName,
  alertOnStart = false,
  shownAt,
}: ChargingIndicatorProps) => {
  const value = Math.min(1, Math.max(0, level));
  const percent = Math.round(value * 100);
  const minutesToFull = timeToFull === undefined ? null : Math.max(1, Math.round(timeToFull / 60000));

  useActivity(() => {
    const low = value < lowThreshold && !charging;
    const color = charging ? islandAccent.green : low ? islandAccent.red : islandInk.primary;
    // The label stays white in every state, as Apple's "Charging" does; the colour lives in the
    // percentage and the battery, so low shows in red there and the label keeps the device's name
    // ("Low Battery" doesn't fit the 72 pt side with its inset).
    const label = charging ? (value >= 1 ? "Charged" : "Charging") : name;
    const fullIn = charging && value < 1 && minutesToFull !== null ? `, full in ${formatMinutes(minutesToFull)}` : "";
    const glyph = <BatteryGlyph level={value} color={color} charging={charging} fillSince={shownAt} />;
    return {
      id,
      priority,
      alert: alertOnStart,
      label: `${name} ${percent} percent${charging ? `, charging${fullIn}` : low ? ", low" : ""}`,
      // The label and the level don't fit the split's bubble: there the battery shows alone, its fill the level.
      compact: withBubble(
        {
          leading: <ChargingLabel>{label}</ChargingLabel>,
          trailing: <ChargingLevel level={value} color={color} charging={charging} fillSince={shownAt} />,
        },
        glyph,
      ),
      minimal: <MinimalPair leading={glyph} trailing={<ChargingPercent level={value} color={color} charging={charging} />} />,
      // Apple's charging indicator has no expanded card, so a long press or an alert opens the same
      // row with one grey line under the label: no bottom region, so the island stays at the engine's shortest.
      expanded: {
        leading: <ChargingRowLabel detail={detailFor({ value, charging, low, name, minutesToFull })}>{label}</ChargingRowLabel>,
        trailing: <ChargingRowLevel level={value} color={color} charging={charging} fillSince={shownAt} />,
      },
    };
  }, [id, priority, percent, charging, minutesToFull, lowThreshold, name, alertOnStart, shownAt]);

  return null;
};

const formatMinutes = (minutes: number) => (minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`);
