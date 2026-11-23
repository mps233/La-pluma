# Glass adapters

App code imports glass UI from `@/components/glass`. These adapters keep the
prop surface the pages already use and render the Liquid Glass UI registry
installed verbatim in `client/src/components/liquid-glass/`.

Do not import the registry directly from pages, and do not edit anything under
`client/src/components/liquid-glass/`. That directory is the shadcn-installed
registry (plus its `controls/` runtime) and must stay byte-for-byte upstream.

## Adapter mapping

| Adapter (`@/components/glass`) | Registry component | Notes |
| --- | --- | --- |
| `GlassButton` | `glass-button` | Old `glass`/`clear`/`ghost` map to `clear`; `filled`/`tinted` map to `tinted` with an inline background. Renders an `<a>` through `asChild` when `href` is set. |
| `GlassCard` | `glass-card` | `regular`/`clear` map to `clear`, `tinted` to `tinted`. `padding`/`radius` are applied as inline style for API compatibility. |
| `GlassSegmented` | `glass-tabs` | Old index-based `value` is converted to string tab values and back. |
| `GlassSwitch` | `controls/Switch` | Needs `three`; mirrors `id` and `aria-label` onto the rendered `[role="switch"]` so external `<label htmlFor>` keeps working. |
| `GlassMenu` | `glass-dropdown-menu` | The popup is portalled into the adapter wrapper so the tabbar's existing CSS contract stays intact. |
| `GlassNav` | `glass-button-group` | Renders `lg-nav` around a `lg-track` group and keeps `data-lg-item` per tab. |
| `GlassInput` | `glass-card` + native input | Renders the kit card as the pill shell with `lg-input-*` hooks for the field, icon, and clear button. |
| `spring` helpers | local `spring.ts` | The old library's spring math was moved here so `useSwipeModeTrack` keeps its feel without a dependency. |

The adapters also emit stable app hooks: `lg-host`, `lg-button`,
`lg-button__icon`, `lg-button__label`, `lg-card`, `lg-segmented`, `lg-switch`,
`lg-menu`, `lg-track`, `lg-nav`, `lg-nav-item`, and `lg-input*`. The semantic
geometry for those hooks lives in the adapter block at the end of
`client/src/ios-theme.css`; add styling there rather than in page files.

## Integration decisions that must not be reverted

- **Hoisted cascade-layer pin.** `main.tsx` renders `CascadeLayers`, and
  `index.html` carries the same `@layer properties, theme, base, components,
  utilities;` statement in `<head>`. The registry's `GLASS_CSS` declares
  `@layer components`; if it were the first layer statement the browser saw,
  `components` would sort before `base` and the reset would wipe component
  spacing. Keep both pins and keep the React one first.
- **`noUncheckedIndexedAccess: false`.** The registry is copied verbatim and
  relies on indexed access (shader and canvas math). Strict null checks remain
  on everywhere else; this single relaxed flag lets the registry compile
  without patching it.
- **One type-only cast in the registry.** `controls/glass/runtime.ts` contains
  the registry's single `as any` escape (`(q as any).x` / `(q as any).y`) inside
  the TSL rounded-rect helper. It is compile-time only and must stay; do not
  "clean it up" or reformat the file.
- **Registry stays verbatim.** Do not edit `client/src/components/liquid-glass/`
  to fit app conventions. Put compatibility logic in these adapters instead.
