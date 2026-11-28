# Architecture Decision Records

Format: a decision gets an ID, a status (`accepted`, `pending`, `superseded`),
the context, the decision, and the consequences. Pending decisions need a
product or maintainer call and are not implemented by governance rounds.

## ADR-0001: Governance records live in `docs/architecture/`

Status: accepted (2026-11-28)

Context: the repository had no durable place for architecture decisions,
canonical-owner maps, or the refactor backlog. Governance knowledge was spread
across `AGENTS.md`, `README.md`, `DESIGN.md`, and the Go rewrite plan.

Decision: create `docs/architecture/` with an architecture map, invariants,
task pool, progress log, and this decision log. These files describe the
current intended architecture; they never override `DESIGN.md` (visual rules)
or `AGENTS.md` (working rules).

Consequences: every governance round updates `PROGRESS.md`; every accepted
structural decision gets an ADR; stale entries are corrected rather than
duplicated.

## ADR-0002: `AGENTS.md` stays the working-rule SSOT

Status: accepted (2026-11-28)

Context: `AGENTS.md` is loaded by coding agents and already contains the
working rules, verification commands, and safety constraints.

Decision: governance work does not duplicate those rules into
`docs/architecture/`. It references them and adds only the architecture map,
invariants that are being enforced mechanically, and the task pool.

Consequences: one source of truth per rule; governance docs stay small.

## ADR-0003: One PRTS retry cadence

Status: accepted (2026-11-28), implements PD5

Context: after the transport move, activity retried at 250 ms × attempt and
copilot at 500 ms × attempt. Both use three attempts; only the backoff
differed, so the same endpoint behaved differently depending on the caller.

Decision: 500 ms × attempt is the canonical cadence for both callers. It keeps
the existing attempt count and reduces burst load on PRTS; the slowest path
adds at most 750 ms across the retry budget.

Consequences: activity search retries slightly later on transient failures.
The shared `infra/prts.RetryPolicy` still accepts a caller policy, so a future
endpoint with different semantics can opt out explicitly.

## ADR-0004: Page run state stays a projection/local hybrid

Status: accepted (2026-11-28), rejects PD3

Context: the global run projection (`statusStore.runStatus` + `runStore`)
already owns the current server Run. Pages also keep local flags for their own
in-flight request and for client-side workflows (AutomationTasks restores a
local task sequence; DataStatistics spans recognition plus data parsing with
no single server Run). Combat/Roguelike now combine a submit flag with
`useOwnedRunActive`.

Decision: keep the hybrid. The projection owns server-run identity, cross-page
visibility, and terminal state; pages may keep a local flag while their own
request or client workflow is in flight, and `useTaskRestoreMonitor` may
continue mirroring the legacy task status. Do not make the projection the only
writer without a server-side Run covering the whole client workflow.

Consequences: C5b is closed as rejected. Polling and keep-alive semantics stay
unchanged; a future single-Run workflow design would need a new ADR.

## ADR-0005: The CustomTools palette is user content

Status: accepted (2026-11-28), resolves PD6

Context: the custom-tool editor lets the user pick one of 40 generated hues
for a tool icon. The theme-color boundary test flags the palette as a literal.

Decision: keep the 40-hue palette. These are content colors chosen by the
user, not brand or semantic UI colors; they must not be used for chrome,
text, status, or surfaces. The file stays in the color-literal allowlist with
this explicit exception.

Consequences: the allowlist no longer implies a pending migration for
`CustomTools.tsx`; new palettes still need a decision.

## ADR-0006: GlassNav/GlassMenu are application adapters

Status: accepted (2026-11-28), resolves PD7

Context: `DESIGN.md` names `GlassNav` and `GlassMenu` as glass surfaces, which
reads as if they were registry exports. The implementation wraps the official
button-group and dropdown-menu primitives in
`client/src/components/LayoutGlassChrome.tsx`.

Decision: the DESIGN names refer to those application adapters, not to
registry exports. Document the adapter location; do not add a parallel nav or
menu implementation.

Consequences: pages continue to use `Layout`'s nav/menu; the adapters stay the
only place that maps app navigation onto the kit.

## ADR-0007: Page base classes stay in the global layer

Status: accepted (2026-11-28), rejects C9/PD8

Context: `DESIGN.md` already requires page CSS files to hold only single-page
rules and to keep shared components, skeletons, and `app-*` classes global.
Page skeletons reuse the page structural classes and render before the lazy
route CSS loads; several `automation-*` classes are also used by
notification/training/dashboard components. A logs trial moved 46 rules and
matched the live page pixel-for-pixel, but the loading skeleton depended on
the removed base rules.

Decision: keep page-prefixed base rules in `index.css`'s `@layer base`. Route
CSS remains the place for page-specific overrides only, per `DESIGN.md`.
C9 is rejected rather than half-migrated.

Consequences: `index.css` stays larger, but loading states and cross-page
components keep their styles. Revisit only if skeletons become
self-contained or get their own eagerly loaded stylesheet.

## ADR-0008: Primitive colour tokens, phase 1

Status: accepted (2026-11-28), starts PD2

Context: `ios-theme.css` is the effective theme layer but wrote semantic
colour values as literals; `DESIGN.md` requires primitives to be the only
layer with colour literals and semantic tokens to reference them.

Decision: add a `--la-*` primitive palette (blue/green/orange/amber/red/
indigo) and rewire the accent, success, warning, danger, and info semantic
tokens to it. Values are unchanged; alpha variants use `color-mix` against the
same primitive. Surfaces, neutrals, spacing/radius primitives, component
tokens, and the `index.css` fallback layer remain follow-up phases.

Consequences: accent/status tokens now have one literal owner. The rendered
dashboard matched the pre-change screenshots pixel-for-pixel except dynamic
timestamps and status text (light/dark, desktop/mobile).

## ADR-0009: Primitive surfaces, spacing, and component tokens

Status: accepted (2026-11-28), continues PD2

Context: after the accent/status palette, the surface, neutral, spacing,
radius, control, and tabbar values in `ios-theme.css` still wrote literals;
cards and the primary action button had no component aliases.

Decision: add neutral/surface (`--la-gray-*`, `--la-slate-*`), spacing
(`--la-space-*`), radius (`--la-radius-*`), control (`--la-control-*`), and
font-size primitives, and rewire the effective theme tokens to them. Add
`--app-card-radius`, `--app-card-continuous-radius`,
`--app-button-primary-bg`, and `--app-button-primary-text` as component
tokens and use them in the shared card and `.brand-action` rules. Alpha
colours use `color-mix` against the same primitive.

Consequences: semantic tokens in the effective layer now reference primitives
only; component tokens reference semantic tokens only. The `index.css`
fallback palette and the remaining literals inside component rules still need
the same pass.

