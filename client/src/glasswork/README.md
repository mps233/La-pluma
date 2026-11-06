# Glasswork

Vendored liquid-glass material from [kubai087/glasswork](https://github.com/kubai087/glasswork) (MIT, see `LICENSE`), pinned at v1.1.0.

| File | Source | Changes |
| --- | --- | --- |
| `glass.css` | `glass.css` | Added `html.dark` / `#app-root.dark` to the dark-material selectors so La Pluma's theme switch picks the kind; defined the material unit (`@property --u` + `.glass { --u: 1px }`, normally set on the playground stage) because the box-shadow/rim rules use bare `var(--u)`; removed playground-only `.stage[data-tuning]` / `.stage[data-refract]` rules; kept the `[data-engine="webkit"]` round-corner rule. |
| `lens.js` | `lens.js` | Verbatim. |
| `lens.d.ts` | — | Local typings for the exports used here. |

The playground's WebGL fallback (`refract.js`) is not vendored: browsers without an SVG lens in `backdrop-filter` keep the CSS glass, which is Glasswork's own fallback.

Usage: put `.glass` on a surface and keep its `backdrop-filter` ending with `var(--glass-lens,)` (the material's `--filter` already does). Call `liquidGlass(element, { rim: 40, edge: 1.1, power: 2.6, dispersion: 0.15 })` for the Chromium rim refraction. Per-surface `--density`, `--keep` and `--floor` tune the tint.

Updating: replace `glass.css` / `lens.js` from the upstream tag, then re-apply every local change in the table above: the `html.dark` / `#app-root.dark` additions to both dark-material selector lists, the `@property --u` registration plus `.glass { --u: 1px }`, the removal of the `.stage[data-tuning]` / `.stage[data-refract="webgl"]` rules, and the local `lens.d.ts`. The `[data-engine="webkit"]` rule is already upstream. Check the version in `INSTALL.md`; the lens options live in `client/src/components/Layout.tsx`.
