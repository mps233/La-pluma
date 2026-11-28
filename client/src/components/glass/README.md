# Glass adapter

`@/components/glass` is the only application-facing import for the Liquid
Glass registry. The registry in `components/liquid-glass/` is vendored from
upstream. Kit upgrades replace it wholesale, so local changes stay limited to
documented patches and must be preserved when upgrading.

## Local patches

- `glass-layer-lazy.tsx` / `glass-lens-lazy.tsx` defer the glass engine until
  after first paint or the first interaction, using `use-deferred-glass.ts`;
  hosts keep the kit CSS fallback until then. `glass-styles.tsx` keeps
  `GlassStyles`/`GLASS_CSS` out of the engine module.
- `controls/glass/useGlassCanvas.ts` defers the three.js runtime until the
  first interaction with a glass control, then broadcasts readiness so every
  mounted canvas upgrades together. `common/Switch.tsx` and
  `common/fields.tsx` paint solid fallbacks until that happens. Reapply this
  patch when merging a new kit release.

## Entry boundary

`GlassButtonGroup` imports only `glass-popup-anchor` (context and anchor
canvas); the popup surface/engine stays with menus and selects.

`LayoutGlassChrome` renders a same-style trigger and lazy-loads
`GlassMenuImpl` on hover or activation, so the popup/menu foundation stays out
of the entry. The build marks `components/glass` and `components/common`
modules side-effect-free; keep them free of top-level side effects.

## Rules

- Application, common, and page components import glass primitives from
  `@/components/glass`, never from `@/components/liquid-glass/...`.
- The adapter re-exports the primitives the app actually uses. Add an export
  when a second caller needs it; do not re-export the whole kit.
- `PreviewModeControls.tsx` is the documented exception: DESIGN.md allows the
  preview card to use the registry `GlassTabs` directly. Do not spread that
  exception to other pages.
- Tests may mock the adapter module; mocking a registry subpath would couple
  the test to the vendored file layout.

`GlassSegmented` is the app's segmented control built on the kit lens. Pages
use it for mutually exclusive views; the preview card's `GlassTabs` remains
the only raw-tabs use.
