# Design rules

What makes an island read as the real thing. Every number is a point (one CSS px) measured from simulator recordings of the reference phone, a 402 × 874 screen. The engine's tables (`islandMetrics`, `islandMotion`) hold the values it draws with; this file explains them so you can lay out content that fits.

## Shape

| State | Width | Height | Top | Corner |
| --- | --- | --- | --- | --- |
| Idle | 94.85 | 36.84 | 13.91, centred | capsule |
| Compact (22 pt glyph and "42") | 150.18, follows content | 36.85 | 13.91 | capsule |
| Held (just before a long-press expands) | 168.34 | 41.29 | 11.70 | capsule |
| Expanded | 374.34 (screen − 2 × 13.83) | follows content, 84 to 180 (104.52 for a 52 pt tile row and a bar) | 13.83 | 47.9, continuous (48.2 measured as a plain circle) |
| Split: attached pill / capsule | 156.85 / 62.18 (fixed), 7.82 apart | 36.85 | 13.91 | capsules |

Every corner is continuous: a circular arc that eases into the straight edges. Content is clipped to a rounded rectangle concentric with the island, radius at most 34.4, so a square tile or a bar that reaches an expanded bottom corner loses its corner, as on the phone.

- The pill is pure black (`#000`). No border, gradient or blur. Only the expanded state casts a shadow (the engine draws it, about `0 10px 32px rgba(0,0,0,0.35)` at rest), and it fades with the height.
- The outline stays sharp through every morph. Only content blurs.
- Wider screens keep these sizes: the engine clamps the island to 402 wide, so expanded is 374 everywhere.
- Don't resize or reshape the pill with CSS. Change the presentation or the content and let the springs move it.

## The sensor area

The idle box (x 153.58 to 248.43 on the 402 screen) is where the camera sits. Content never goes there.

- **Compact** grows outward from it: leading content to the left, trailing to the right, each side as wide as its content (at most 72; a longer plain string ends in an ellipsis). With unequal sides the pill sits off centre (centre x 199.67 for the measured content). The 22 pt leading glyph sits 7.42 from the pill's left, top and bottom: concentric with the end. Trailing text starts about 0.6 after the sensor and ends 8.4 from the pill's right end.
- **Compact balance**: with content on both sides, neither side reaches less than 0.7475 of the other beyond the sensor. The short side grows and its content stays at the pill's outer edge, leaving black space next to the sensor (held-out content: a 35.66 leading side against a 47.66 trailing one, its circle 6.65 short of the sensor). That is how the reference phone lays it out; don't pad it away.
- **Split**: the attached pill ends exactly at the sensor's right edge and grows only leftward; the capsule sits 7.82 to its right. Each shows its activity's compact pair. The capsule is 62.18 wide whenever it has a trailing value: the value is centred in the room after the leading glyph (about 20 pt after a 22 pt glyph) and a wider string ends in an ellipsis ("12:45" shows "1…"). Over 290 for both shapes, each falls back to `minimal`.
- **Expanded**: the top row is top-aligned. The content frame is inset 18.5 from the left edge and 17.81 from the right (not centred; the center region still sits on the island's centre line): a 52 pt leading tile sits 18.5 from the left and 18.2 from the top, and a trailing value (34 pt bold) starts at the same top and ends at the 17.81 inset. `center` starts below the sensor's bottom edge, about 20 pt lower (17 pt semibold title). Side content that should sit level with something taller gets a fixed frame (`ExpandedSide`), as a native region with a fixed frame height does. A bottom bar is 8 tall with about 21.5 side insets and 18.35 from the bottom edge.

## Concentric content

Inner shapes follow the pill's curve. A tile or button inset by `p` from a corner of radius `R` gets radius `R − p`: the 52 pt tile at about 18 inset uses radius 12 (continuous, `continuousCorner` in the theme; `IconTile` and `Artwork` already do). Full-width buttons in `bottom` are capsules.

## Colour

- Text is white. Secondary text is `rgba(235, 235, 245, 0.62)`, tertiary 0.36 (`islandInk`).
- One hue per activity, carrying meaning: green for calls, charging and arrival (`#32d74b`); orange for timers and caution (`#ff9f0a`); red for recording, failure and destructive actions (`#ff453a`); blue for progress (`#0a84ff`); lagoon (`#46f0c6`) for agents, islandcn's own accent.
- Fills inside the pill: white at 14% for neutral buttons and tracks, the accent at 16% behind a tile's glyph (`tint(accent, 0.16)`).
- On a dark page the black pill nearly vanishes at rest. The phone draws a thin grey keyline just outside the edge (1.5 pt, white at 0.16 over #000, fading out by about #2C2C2E), and so does the engine: `<Island backdrop="#0b0b0f" />` sets its strength from the page colour, `keyline="on"` or `"off"` forces it. It is 7% weaker on the expanded island, absent at idle, and dims during a collapse.

## Type

- System font stack: `-apple-system, BlinkMacSystemFont, "Inter", "Geist", system-ui, sans-serif`. Devices with a native UI font render it; never bundle a system font file.
- Compact values: 15 pt semibold, tabular numbers. Expanded title 17 pt semibold, subtitle 15 pt, caption 13 pt, large value 34 pt bold.
- One line per region in compact. Truncate rather than wrap; the expanded subtitle may take two lines.

## Icons

No system symbol fonts and no platform artwork. The content kit's glyph set (`glyphs.tsx`) is Hugeicons' free set (MIT) drawn for the island: outlines at 2 units of the 24 unit grid at 22 pt (1.83 pt, about the island's semibold digit stems; Hugeicons' own 1.5 reads hairline in a black pill), a little heavier when small and lighter when large. Media controls, the handset, the pin, the bolt, the message bubble and the microphone's capsule are solid, as system glyphs are at island sizes; tools and devices stay outlines. Draw them in white or the activity's colour. For a shape the set doesn't name, `glyphFrom(name, icon, { parts })` turns any free Hugeicons icon into a glyph at the same weight.

## Motion

Springs use `response` and `dampingFraction`, the two numbers native spring animations take. The simulator's, fitted frame by frame:

| Transition | response | dampingFraction | Notes |
| --- | --- | --- | --- |
| appear (idle to compact) | 0.483 | 0.62 | 8 to 11% overshoot |
| alert expand | 0.517 | 0.824 | height on 0.497 / 0.825 |
| long-press expand | 0.387 | 0.792 | starts from the swell, keeping its speed |
| collapse | 0.479, then 0.46 | 0.894, then 0.555 | the waist pulls in to about 105 wide and bounces back; height 0.453 / 0.928 |
| dismiss (compact to idle) | 0.442 | 0.97 | |
| split / unsplit | 0.505 / 0.5 | 0.815 / 0.74 | both pass through the idle shape and retarget after about 0.2 s |

- Every press swells the pill from touch-down, a uniform scale toward 1.12. Still held at 0.1 s it is a long-press, and the island expands 0.22 s after touch-down. Released sooner it is a tap: `onPress` runs and the swell springs back.
- An alert holds expanded for 5.975 s (`motion.alertHold`). Its new content lands 0.12 s after the expansion starts, so numbers turn over once the view is open.
- Groups: an alert on a hidden group member takes the shown one to idle, waits 1.458 s, expands the new one, and returns to compact 6.014 s after the first left.
- Changing numbers turn over digit by digit (`IslandNumber`): the old character shrinks and blurs, then fades by 0.26 s; the new one appears at 0.2 s and is sharp by about 0.48 s. Bars spring to their new value (`IslandProgress`, 0.97 / 0.74).
- Content: outgoing text leaves in 0.03 to 0.05 s, shapes in 0.1 to 0.15 s; incoming content waits until the shape is most of the way there (0.18 to 0.4 s), then blur-scales in. Don't add your own enter animations to region content.
- With `prefers-reduced-motion: reduce`, the shape eases over 0.2 s with no overshoot and content crossfades without blur or scale.

## Checklist

- [ ] Pill is `#000`; you added no border, shadow or gradient
- [ ] Idle is an empty capsule
- [ ] Compact content clear of the sensor, leading glyph concentric with the end
- [ ] Trailing compact text ≤ about six characters, tabular numbers
- [ ] Compact pair works in the split capsule too (trailing about 20 pt), with a `minimal` fallback (`MinimalPair`)
- [ ] Expanded side content that should sit level has an `ExpandedSide` frame
- [ ] Related activities from one source share a `group`; unrelated ones don't
- [ ] Every reachable presentation has content, every activity has a `label`
- [ ] Alerts only for things the user must notice now; approvals use `expand`
- [ ] Checked at desktop and phone width, and with reduced motion
