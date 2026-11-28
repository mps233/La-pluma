# Architecture Map

This is the current intended architecture. It describes ownership and
dependency direction; `DESIGN.md` remains authoritative for visual rules and
`AGENTS.md` for working rules. Known deviations are listed at the end and
tracked in `TASKS.md`.

## System shape

```
React client (SPA / PWA / MyGo WebView)
  │  HTTP /api/*, /webrtc-signaling, WebSocket
  ▼
Go backend
  ├─ transport/httpapi      health, auth, static SPA, mounts
  ├─ transport/agentapi     /api/agent surface (107 routes)
  ├─ transport/signaling    WebRTC signaling
  ├─ internal/app           composition root + cross-service adapters
  ├─ internal/app/*         feature services
  ├─ internal/domain        pure contract types
  ├─ internal/infra         ADB, MAA CLI, scrcpy, Pion, gamedata, assets
  ├─ internal/contract      Agent API registry → manifest + OpenAPI
  └─ internal/util          errors, JSON store, instance lock
  │
  ▼
External: maa CLI / MaaCore, adb, scrcpy-server, Telegram, PRTS, Skland
```

Entries: `go/cmd/server` (headless/Docker/NAS) and `go/main.go` (MyGo desktop)
share `internal/app`. Both must mount the same transport surface.

## Go layers and dependency direction

Enforced by `go/internal/archguard` (`TestInternalDependenciesPointDownward`):

```
transport → app → infra / domain
                ↘ util / config
```

- `internal/domain` and `internal/config` import no internal package.
- `internal/contract` and `internal/archguard` are pure and import no internal package.
- `internal/util` may import only `internal/util/*`.
- `internal/infra` may import `internal/infra`, `internal/util`, `internal/config`, `internal/domain`.
- `internal/app` may import any of the above, but an app subpackage must not
  import the `internal/app` composition root.
- `internal/transport` may import anything internal.
- A new top-level `internal/<layer>` must be added to the guard's rule table;
  the guard fails otherwise.

## Canonical owners

| Concept | Owner | Notes |
| --- | --- | --- |
| Run status strings, record, DTO, links | `internal/domain/agentrun` | Public API contract; tested |
| Persisted recognition schema | `internal/domain/snapshot` | operbox/depot document shapes + `DecodeOperBox`/`DecodeDepot`; recognition aliases them, training/mastery/API decode through them |
| Run lifecycle, persistence, idempotency, restore | `internal/app/agentrun` (`Service` + single-writer `Scope`) | Transition methods are unexported; transport and services delegate through `Scope` and only read via `Get`/`Current`/`List` |
| MAA process lifecycle | `internal/infra/maa` + `internal/app/maa` | CLI spawn/stop/line capture |
| MAA execution lease | `internal/app/execution` | Cross-process admission |
| Data directory and env-derived paths | `internal/config` | `Paths` also owns the on-disk file and directory names; `Tuning` owns optional runtime knobs |
| User configs, MAA profiles, `cli.toml` | `internal/app/config` | JSON + TOML; atomic writes via `jsonstore` |
| JSON persistence and atomic file replace | `internal/util/jsonstore` | `Read`/`Write`/`WriteRaw` |
| JS value coercion for upstream JSON | `internal/util/jsval` | `Record`/`Array`/`Text`/`TextOK`/`String`/`StringJSON`/`Number`/`FiniteNumber`/`FiniteNumberOrNull`/`Numeric`/`Truthy`; all application readers migrate through it |
| API timestamp format | `internal/util/timefmt` | One millis layout + UTC formatter; offset/date layouts |
| Public Agent API contract | `internal/contract` | Manifest and OpenAPI derive from one registry |
| PRTS HTTP transport | `internal/infra/prts` | Request construction, timeout, status, JSON decode, retry loop; callers own envelope parsing and retry policy |
| HTTP client construction | `internal/infra/httpclient` | Timeouts and transport defaults; retries stay with the endpoint owner |
| Shared HTTP mount surface | `internal/transport/bootstrap` | Desktop and headless entries pass its options, then append entry-only options |
| MaaResource image serving | `internal/infra/assets` + `internal/transport/assetsapi` | Resolution and WebP cache in infra; routes, cache headers, and raw image responses in transport |
| HTTP envelope and error mapping | `internal/transport/httpx` | `success/message/data/error/meta` |
| Agent route registration | `internal/transport/agentapi` | Every advertised operation must resolve (tested) |
| Scheduler state and flows | `internal/app/scheduler` | Startup resume + tracked runs |
| Client HTTP access | `client/src/services/api.ts` | `fetchWithAuth`; known bypasses in `TASKS.md` |
| Client global state | `client/src/state` | One Zustand file per concern + barrel |
| Client design system | `DESIGN.md`, `components/common`, `components/glass` | Tokens in `index.css` + `ios-theme.css` |
| Vendored glass kit | `components/liquid-glass` | Verbatim; app imports go through `components/glass` |

## Client layout

- `App.tsx` owns routing and the visited-workspace keep-alive (max 4 pages).
- Pages are lazy-loaded by `utils/pagePreload`; page-only CSS lives in
  `styles/pages/*.css` and loads with the route.
- `components/common/` holds shared primitives exported from the barrel;
  page-specific visual compositions stay with their page.
- `components/glass/` is the only application-facing Liquid Glass surface.
- `services/api.ts` is the single HTTP client; raw `fetch` is enforced there.
  Page components should call `maaApi` or a domain service module.
- `state/` is the single Zustand module: one file per concern and one barrel.
  Pages and hooks import `@/state`; tests mock `@/state` only.

## Known deviations

These are real today and tracked in `TASKS.md`; do not add new code that
depends on them.

1. `operbox.json` / `depot.json` and the `user-configs` path are composed in
   multiple packages without one typed owner.
2. The client derives Combat/Roguelike run state from the global projection
   but still keeps submit-in-flight flags; Automation/DataStatistics keep
   their own workflow flags, and `useTaskRestoreMonitor` still writes the
   running flag alongside the projection (PD3).
3. `client/src/components/common` exports only part of its usable primitives,
   so some consumers still deep-import; page skeletons live in `Loading.tsx`.
4. Token layers in `DESIGN.md` (primitive/semantic/component) are partly
   aspirational; page CSS and some JS colors still use literals.
5. `internal/app/logs` has no tests; `agentapi` exercises ~17% of its routes.
