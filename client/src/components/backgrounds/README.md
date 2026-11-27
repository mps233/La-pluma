# Ambient backgrounds

## ASCII field (active)

`AsciiFieldBackdrop` is the ambient layer mounted by `Layout`. It paints a
still field of glyphs into a 2D canvas once per mount, theme change, or settled
resize. There is no frame loop, no WebGL context, and no per-frame budget.

The implementation lives in `components/backgrounds/AsciiFieldBackdrop.tsx`;
the styles live in `components/backgrounds/AsciiBackdrop.css`. Do not add a
second background implementation or per-call-site media queries.

| Prop | Default | Purpose |
| --- | --- | --- |
| `color` | theme accent (`--app-accent`, `--app-accent-strong` in dark) | Ink colour for a single-tone field. |
| `colors` | none | Two to six colours, faintest to densest; overrides `color`. |
| `background` | transparent | Base colour behind the glyphs; normally left to the page. |
| `className` | none | Extra classes appended after `ascii-field`. |
| `intensity` | CSS default (`0.18` light / `0.24` dark, `0.12` narrow, lower under reduced motion) | Layer opacity override via `--ascii-field-opacity`. |

Behaviour the wrapper owns:

- Theme changes are observed on `document.documentElement`; the glyph field is
  re-read from the semantic accent tokens, not from hard-coded page colours.
- The layer is `position: absolute` rather than `fixed` so Safari does not
  sample it for the status bar and toolbar tint.
- The root carries `data-glass-skip` so `material="clear"` glass does not copy
  the full-screen canvas into its background snapshot.
- Resize repaints are debounced (140 ms); a window-edge drag does not repaint
  thousands of glyphs every frame.
