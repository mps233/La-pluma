# Glass adapter

`@/components/glass` is the only application-facing import for the Liquid
Glass registry. The registry in `components/liquid-glass/` is vendored
verbatim and must not be edited; kit upgrades replace it wholesale.

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
