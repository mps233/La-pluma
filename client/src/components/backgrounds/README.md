# Ambient backgrounds

## ASCII field (active)

`AsciiFieldBackdrop` is the ambient layer mounted by `Layout`. It wraps the
vendored uibrik WebGL2 `AsciiField` component in
`components/uibrik/ascii-field`, so the background uses the original shader
field, glyph atlas, pointer lens, fading wake trail, and click rings.

The wrapper keeps the app's own stacking, opacity, and theme rules:

| Prop | Default | Purpose |
| --- | --- | --- |
| `color` | theme accent | Ink colour for a single-tone field. |
| `colors` | none | 2-6 stops from faintest to densest; overrides `color`. |
| `pattern` | `flow` | `flow`, `waves`, or `rings` shape family. |
| `characters` | `" .:-=+*#%@"` | Glyph ramp from empty to dense. |
| `cellSize` | `14` | Row height in CSS pixels. |
| `density` / `fade` | `0.64` / `0.56` | Share of the field carrying glyphs and edge falloff. |
| `glow` / `twinkle` | `0.5` / `0.42` | Tint under dense areas and occasional flares. |
| `interactive` | `true` | Pointer lens, trail, and click rings. |
| `intensity` | CSS default (`0.18` light / `0.24` dark) | Layer opacity override. |

Sharpness is pinned by two values the wrapper sets on the renderer:

- `minResolutionScale={1}` disables the renderer's adaptive downscale, which
  otherwise drops the canvas to 75% / 50% of the device pixel ratio on a slow
  frame budget and stretches it back up — the source of the earlier blur.
- `lodBias={-0.6}` samples the glyph atlas closer to its native size so the
  type stays legible instead of dissolving into a soft dot grid.

`maxFps={40}` pays for the extra pixels: the field drifts slowly, so the cap is
invisible while the full-resolution frames are not.
