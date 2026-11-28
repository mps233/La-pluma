# Progress Log

## Baseline — 2026-11-28

Recorded on the `worktree-arch-entropy` worktree at commit `8b9d96b5`
(`perf(client): update liquid glass kit to upstream 2.0.2/2.0.3`).

| Check | Result |
| --- | --- |
| `go build ./...` | pass |
| `go test ./...` | pass |
| `go vet ./...` | pass |
| `gofmt -l .` | clean |
| `npm ci --prefix client` | pass |
| `npm run lint --prefix client` | pass (0 warnings) |
| `npm run type-check --prefix client` | pass |
| `npm run test --prefix client` (Node 26 flag) | pass |
| `npm run build --prefix client` | pass |

Observation from the baseline: `internal/app/logs`, `internal/domain/agentrun`,
`internal/transport/httpx`, and `internal/util/errors` have no tests. The last
two are contract-critical (shared HTTP/error envelope) and are tracked in
`TASKS.md`.

## Convergence snapshot — 2026-11-28

After twenty-four rounds the worktree has one declared owner for each of these
concepts, with the old copies deleted:

| Concept | Canonical owner | Enforced by |
| --- | --- | --- |
| Go layer direction | `internal/archguard` rules | `go test ./internal/archguard` |
| Agent operation → route | `internal/contract` + `agentapi` mux | `route_contract_test.go` |
| HTTP envelope and error mapping | `transport/httpx` + `util/errors` | unit tests |
| Run status/record/DTO | `domain/agentrun` | contract tests |
| Run lifecycle transitions | `app/agentrun` (`Scope`) | unexported mutators + `TestRunLifecycleStaysInAgentRunScope` |
| Atomic persistence | `util/jsonstore` (`Write`, `WriteRaw`) | store tests |
| JS value coercion | `util/jsval` | coercion tests |
| Timestamp layouts | `util/timefmt` | layout tests |
| Data file names and user-config dir | `config.Paths` | path tests |
| Connection defaults | `app/config.ConnectionDefaultsFromEnv` | precedence tests |
| MAA executable | `config.Config.MAAExecutable` | config tests |
| Quotes HTTP surface | `transport/quotesapi` | handler tests |
| Agent API file layout | 15 domain files + 800-line guard | `TestAgentAPIFilesStaySmall` |
| Client global state | `client/src/state` + one barrel | type-check/tests |
| Client HTTP access | `services/api.ts` | `apiBoundary.test.ts` + component tests |
| Client glass kit boundary | `components/glass` | ESLint `no-restricted-imports` |
| Client formatting/errors | `utils/format.ts`, `utils/errorMessage.ts` | unit tests |
| Client draft-sync protocol | `utils/configSync.ts` | gate tests |
| Client lint level | `client/package.json` ratchet | `npm run lint` |

Deleted along the way: the private atomic writer, `MAAServiceService`, the
second `Profiles` cache, the dead `uibrik` kit, the `store/` vs `stores/`
split, three token/queue implementations, the local duration/timestamp/
error copies, the 3,450-line `handler.go`, the quotes router inside the
application package, and the transport-local run lifecycle (begin/start/
fail/stop/settle helpers).

Remaining high-value work is recorded in `TASKS.md`; the largest items are
typed operbox/depot schemas (`G3`), the remaining `jsval` packages (`G1`,
blocked on intentional null/undefined differences), one PRTS client (`G2`,
blocked on retry semantics), the assets router move (`G6`), the API module
split (`C7`), and the visual token/CSS migrations (`C8`, `C9`). Workflow
changes (`PD1`) remain intentionally untouched. Each is either a
decision-blocked item or a dedicated multi-round refactor; no half-migrated
state was left behind.

## Round log

Rounds are appended in order. Each entry states scope, what changed, what was
deleted, verification, and follow-ups.

### Round 1 — contract baselines (2026-11-28, `c911baf1`)

- Added direct tests for the shared HTTP envelope (`httpx`), application error
  helpers (`util/errors`), and the run status/DTO contract (`domain/agentrun`).
- No production change. Go test suite passes.
- Follow-up: route-level conformance remains partial (see G9).

### Round 2 — executable layer guard (2026-11-28, `3ee740f0`)

- Added `internal/archguard`: walks imports and enforces the downward
  dependency direction plus a declared rule for every top-level layer.
- The current tree already satisfied the rule; no migrations were needed.

### Round 3 — contract/route drift guard (2026-11-28, `f39b6d24`)

- Added a test that resolves every registry operation against the real
  `http.ServeMux`.
- Reverse direction is intentionally open: 61 client-facing routes are not
  advertised in the Agent contract; documented in the test comment.

### Round 4 — delete duplicate write and wiring layers (2026-11-28, `d2c385e5`)

- `jsonstore.WriteRaw` is now the single atomic file-replace implementation;
  `app/config` deleted its private copy.
- Removed `App.MAAServiceService`, a pass-through to an exported field.
- The scheduler now receives the composition root's `Profiles` instead of
  constructing a second cache.
- Deleted: `go/internal/app/config/atomic.go`, one method.

### Round 5 — Docker detection (2026-11-28, `1e22c858`)

- `defaultIsDocker` no longer requires `NODE_ENV=production` (never set in the
  Go image); it uses `/.dockerenv` or `DOCKER_ENV`.
- Added tests for the override and for ignoring `NODE_ENV`.

### Round 6 — delete dead vendored background (2026-11-28, `d7736830`)

- Deleted `client/src/components/uibrik/` (3 files, zero importers).
- Rewrote `components/backgrounds/README.md`, which still described the
  removed WebGL wrapper.
- Deleted: 3 files; removed the ESLint ignore for the deleted folder.

### Round 7 — lint ratchet (2026-11-28, `e4843dda`)

- Fixed the effect dependency surfaced by adding the stable store action;
  destructured the preview session values used by its restart effect.
- `--max-warnings` lowered from 12 to 1 (the one remaining warning is the
  giant-page callback; see C11).
- `verify` no longer runs `type-check` twice.

### Round 8 — glass adapter boundary (2026-11-28, `ffed77d2`)

- Created `client/src/components/glass` as the only application-facing surface
  for the vendored kit, with a README and a curated export list.
- Moved `GlassSegmented` into the adapter; updated six page imports.
- Migrated all 17 direct kit imports to the adapter; the only direct import
  left is the DESIGN-documented preview `GlassTabs` exception.
- Added an ESLint `no-restricted-imports` rule to keep the boundary.
- Deleted: `client/src/components/common/Segmented.tsx` (moved).

### Round 9 — governance records (2026-11-28, `04f6bf8c`)

- Added `ARCHITECTURE.md`, `INVARIANTS.md`, `TASKS.md`, and this log.
- No production change.

### Round 10 — extract the duplicated task restore monitor (2026-11-28)

- CombatTasks and RoguelikeTasks carried the same 86-line run-restore and
  2 s poll effect, differing only in task type and one warning string.
- Added `hooks/useTaskRestoreMonitor` and `useTaskRestoreMonitor.test.ts`
  (restore, non-matching type, stale run, three-failure warning).
- Both page effects now only load configuration; polling has one owner.
- Deleted: two inline copies of the effect (~170 lines total).
- Verified: type-check, full client tests (73 files / 508 tests), lint at
  the ratchet.

### Round 11 — canonical format and error helpers (2026-11-28)

- Added `utils/format.ts` with the three duration contracts, both timestamp
  contracts, remaining time, and timestamp parsing; added tests.
- Added `getErrorMessageOr` and `getApiErrorMessage` to `utils/errorMessage.ts`.
- Migrated CombatExecutionProgress, AutomationTasks, DataStatistics,
  MasteryTrainingWorkspace, NotificationSettings, LogViewer, and
  MaaUpdateIsland; deleted their local copies.
- Deleted: six local formatter/error functions and one module-level `Intl`
  formatter.
- Verified: type-check, 74 test files / 514 tests, lint at the ratchet.

### Round 12 — move the notification API into the service layer (2026-11-28)

- `NotificationSettings.tsx` contained its own response types, cache, request
  dedupe, and three raw `fetchWithAuth` calls.
- Added `notificationsApi` (get/save/test), the config types, the clone
  helper, and the shared cache to `services/api.ts`; the component keeps only
  its draft/save lifecycle.
- Merged the duplicated `AutoUpdateConfig` into the `types/components` import.
- `maaApi.getErrorMessage` now accepts a caller fallback.
- Updated the component test to mock the service boundary while keeping the
  request-option and abort assertions.
- Deleted: one embedded API module (~70 lines), one duplicate type.
- Verified: type-check, 74 test files / 514 tests, lint at the ratchet.

### Round 13 — one state module (2026-11-28)

- Moved all seven Zustand stores and their tests from `store/` and `stores/`
  into `state/`, with one barrel exporting the public hooks and types.
- Migrated ~50 imports to `@/state`, including test mocks; mocks now spread
  the real module and override only the hook under test.
- Deleted: `stores/index.ts` and the two old directories.
- Verified: type-check, 74 test files / 514 tests, lint at the ratchet, build.

### Round 14 — canonical JS value coercion (2026-11-28)

- Added `internal/util/jsval` with explicit contracts for the idioms the
  backend actually needs: `Text` (type assertion), `String` (JS `String`),
  `StringOrNullish` (`?? ""`), `StringOrEmpty` (`|| ""`), plus record/array,
  truthiness, number/integer, float formatting, and JSON parsing.
- Migrated `app/activity` and `app/copilot`, the two largest copies, and
  deleted their local helpers (~450 lines). `asString` call sites map to
  `jsval.Text`, not `jsval.String`; the stage-ID regression test caught the
  difference.
- Tests cover every coercion contract, including large-number JSON parsing.
- Verified: full Go test suite, vet, gofmt.
- Follow-up: thirteen packages still carry local copies (tracked in G1).

### Round 15 — one timestamp format (2026-11-28)

- Added `internal/util/timefmt` with the millis API layout, the offset layout
  used by resource metadata, and the calendar-date layout; `FormatMillis`
  always renders UTC.
- Migrated 10 timestamp format sites (agentrun, mastery, activity, training,
  drops, scheduler, skland ×2, recognition, updates) and six date-format
  sites; deleted recognition's private `timestampLayout` constant.
- Verified: full Go test suite, vet, gofmt.
- Timezone strategies (game timezone vs business date vs provider time) were
  left alone; only the layout is shared.

### Round 16 — documentation and config drift (2026-11-28)

- Fixed the Chinese README's action count (26 → 40), the stale `src/store/`
  path in both READMEs, the redundant Docker `ADB_PATH` instructions, and the
  `go/README.md` verify list (lint/test and the Node 26 flag).
- Renamed the root package `maa-prts` → `la-pluma`.
- Implemented the documented `LA_PLUMA_MAX_REALTIME_LOGS` option in
  `internal/config` (default 5000, range 100–1000000); the desktop entry uses
  the 5000 default; added config tests and README rows.
- Corrected stale `PLAN.md` entries (phase status, target layout, MyGo pin,
  copilot wiring).
- Verified: Go build/tests/vet in the touched packages.

### Round 17 — own storage filenames in config.Paths (2026-11-28)

- `operbox.json`, `depot.json`, and the `user-configs` directory were spelled
  in twelve production sites, with two duplicate constants.
- Added `OperBoxFile`/`DepotFile`/`UserConfigsDir` and
  `OperBoxPath`/`DepotPath`/`UserConfigDir`/`UserConfigPath` to `config.Paths`;
  migrated recognition, training, mastery, activity, scheduler, notifications,
  skland, app config, and transport.
- Deleted: two duplicate constants and five unused imports.
- Verified: full Go test suite, vet, gofmt; added path tests.
- Follow-up: the JSON schemas themselves remain untyped (G3).

### Round 18 — one draft-sync protocol (2026-11-28)

- AutomationTasks, CombatTasks, and RoguelikeTasks each had their own token
  sequence, serialization queue, and pending-key localStorage calls.
- Added `utils/configSync.ts` (`createConfigSyncGate`) with token generation,
  serialization, and pending-token semantics, plus tests for ordering,
  failure recovery, and per-key tracking.
- Migrated all three pages; automation's save now runs through the same gate
  instead of a page-local promise ref.
- Deleted: three token/queue implementations and one promise ref.
- Verified: type-check, 75 test files / 517 tests, lint at the ratchet.

### Round 19 — cover the log buffer and composition root (2026-11-28)

- Added `internal/app/logs` tests: eviction, recent limits, sequence
  filtering, stream-to-level mapping, clear monotonicity, UTC timestamps.
- Added a composition-root test that asserts every service is wired after
  `app.New`, alongside the existing instance-lock test.
- Verified: full Go test suite.
- Follow-up: agentapi still exercises a minority of its routes (G9 remainder).

### Round 20 — one connection-default resolver (2026-11-28)

- The notification bot hard-coded the macOS ADB path on every platform;
  WebRTC duplicated the same env/default ladder.
- Both now call `app/config.ConnectionDefaultsFromEnv`, which owns
  `ADB_PATH`, `ADB_ADDRESS`, `MAA_CLIENT_TYPE`, and the platform defaults.
- Added precedence/platform tests for the bot helper.
- Documented every remaining environment variable (advanced table) in both
  READMEs, including the WebP, battle OCR, mastery tick, drop TTL, scrcpy,
  and dev-proxy variables.
- Verified: full Go test suite, vet, gofmt.

### Round 21 — split the agent API god file (2026-11-28)

- `agentapi/handler.go` was 3,450 lines and every API change touched it.
- Split the 158 declarations into 15 domain files in the same package:
  runs/actions, logs, config, drops, screen, training, notifications,
  schedule, copilot, activity, recognition, mastery, skland, webrtc; shared
  decoding/envelope/lifecycle helpers remain in `handler.go` (775 lines).
- No behavior change: all agentapi tests pass; the move was verified by the
  compiler and existing tests.
- Added `TestAgentAPIFilesStaySmall` (800-line limit) so a god file cannot
  grow back unnoticed.
- Verified: full Go test suite, vet, gofmt.
- Follow-up: the run lifecycle is still called from handlers (G7, closed in
  Round 31).

### Round 22 — move the quotes router into transport (2026-11-28)

- `app/quotes` owned a seven-route `http.Handler` with its own raw JSON
  writer, so the application package depended on HTTP routing.
- Moved the handler and its tests to `transport/quotesapi`; both entries mount
  it from there. The raw JSON contract is unchanged (the Node routes never
  used the success envelope).
- Deleted: the handler from the application package; no route or payload
  change.
- Verified: quotes handler/service, httpapi, and full Go suite.
- Follow-up: `infra/assets` still owns its router (G6 remainder).

### Round 23 — resolve the MAA executable once (2026-11-28)

- `MAA_CLI_PATH` was read by the composition root, the mastery adapter, the
  updates service, and the desktop entry, with different Docker fallbacks.
- Added `Config.MAACLIPath` (resolved in `Load`, including the Docker default)
  and `Config.MAAExecutable()`; the composition root, mastery, and updates
  now receive the resolved value. The desktop entry snapshots the env it
  already discovers into the config.
- A zero-value Config still honors `MAA_CLI_PATH` inside `MAAExecutable`, so
  direct config literals and tests keep their behavior; the read lives only
  in the config package.
- Verified: full Go test suite, vet, gofmt; added config tests.

### Round 24 — enforce the client API boundary (2026-11-28)

- The only raw `fetch` outside `services/api.ts` was a local helper named
  `fetch` in Dashboard; renamed it to `loadDeviceStats` to remove the
  ambiguity.
- Added `services/apiBoundary.test.ts`: a build-time glob scans application
  sources (excluding vendored kits and tests) and fails if `fetch(` appears
  outside the shared client.
- Verified: type-check, 76 test files / 518 tests, lint at the ratchet.

### Round 25 — resolve task tuning in config (2026-11-28)

- Battle OCR on/off and interval, mastery tick, drop-stat TTL and timezone,
  asset WebP kill switch and concurrency, scrcpy path/version, and the WebRTC
  device id were read from the environment inside five services.
- Added `config.Tuning` and `LoadTuning`, with the same defaults, clamps, and
  invalid-value behavior; `Config` carries it and the desktop entry loads it.
- Wired the resolved values through the existing copilot/mastery/drops/assets/
  WebRTC options; deleted the service-level env readers and their tests (the
  parsing cases moved to `tuning_test.go`).
- Verified: full Go test suite, vet, gofmt.
- Follow-up: ADB address fallbacks, TURN settings, Docker detection, and
  `MAA_CLIENT_TYPE` still read the env in services (G11 remainder).

### Round 26 — enforce the app/HTTP boundary (2026-11-28)

- After the quotes move, no `internal/app` production file owns an HTTP
  handler. Added an archguard test that fails if `ServeHTTP` or `http.Handler`
  appears anywhere in the application layer.
- `infra/assets` remains the one known routing exception, recorded in G6.
- Verified: archguard and full Go suite.

### Round 27 — complete the common component barrel (2026-11-28)

- `components/common/index.ts` exported 13 entries but five used primitives
  were only reachable by deep import (`ActivityIndicator`, `Tooltip`,
  `GlassLiveCardButton`, `CheckboxField`, `GlassSelectWithFill`, `SelectField`).
- Added them to the barrel and migrated all six deep imports across pages.
- Updated the Dashboard test's module mock for the now-barrel imports.
- Verified: type-check, 76 test files / 518 tests, lint at the ratchet.
- Follow-up: page skeletons still live in `Loading.tsx` (C10 remainder).

### Round 28 — finish the environment-access migration (2026-11-28)

- Added the remaining knobs to `config.Tuning`: ADB path/address, MAA client
  type, Docker detection, and the five TURN settings.
- WebRTC (connection + TURN), MAA (address fallback), scheduler, updates
  (Docker), and the notification bot (connection + client type) now receive
  resolved values; their env readers are gone.
- `config.DetectDocker` replaces the updates-local check; its tests moved to
  the config package.
- Added `TestEnvironmentReadsStayInConfig`: production code outside
  `internal/config` and `internal/app/config` must not call `os.Getenv` or
  `os.LookupEnv`. Entry points remain allowed to snapshot paths into Config.
- Verified: full Go test suite, vet, gofmt.

### Round 29 — ratchet new color literals (2026-11-28)

- Added `styles/themeColorBoundary.test.ts`: a build-time glob rejects new
  hex/rgb/hsl literals in TS/TSX outside the vendored kits and a documented
  allowlist of files awaiting visual migration.
- The allowlist is the shrinking mechanism for C8; existing rendering is
  untouched.
- Verified: type-check and the boundary test.

### Round 30 — own the recognition document schema (2026-11-28)

- `DepotItem`, `DepotOutput`, `OperBoxRecord`, and `OperBoxOutput` were
  defined inside the recognition service even though training, mastery, and
  the Agent API read the same files.
- Moved the definitions to `internal/domain/snapshot`, added JSON-shape tests,
  and made recognition alias them so its API and tests are unchanged.
- Verified: full Go test suite, vet, gofmt.
- Follow-up: readers still decode untyped maps (G3 remainder).

### Round 31 — one writer for the run lifecycle (2026-11-28, `af7ed10`)

- G7 / PD4: transport, the MAA service, the startup resumer, and the cron
  flow wrapper each carried their own begin/start/fail/stop/complete sequence,
  with three copies of the "action ended because stop was requested" rule.
- Added `app/agentrun.Scope`: `Open` begins or replays a run; `Execute` starts
  it, attaches the parent-run context, invokes the action, and settles exactly
  once (`succeeded` / `failed` / `stopped`, including a concurrent stop that
  already moved the run to `stopping`); `Settle` owns the manual copilot-step
  matrix (`completed` / `stopped` / `waiting` / `failed`); `Stop` owns accepted
  cancellation (with idempotency release), stopping escalation, and the
  external stop callback; `Progress` owns task-result updates; `Interrupt`
  owns graceful shutdown.
- Every lifecycle mutator on `Service` is now unexported, so the compiler
  enforces the scope as the only writer. Transport keeps only `Get`/`Current`
  reads and response marshalling; `executeTrackedOperation` is a thin
  `Open`/`Execute` delegate.
- Migrated all callers and deleted the old implementations: the transport
  `settleManualRun`, stop-run transition block, `isTrackedStopError`,
  `errTrackedActionStopped`, `runFailureError`, and the duplicated
  `executeTrackedResult` alias; the MAA service's private begin/start/fail/
  complete sequence and `StopCurrent` transition block; the resume and cron
  wrappers' switch statements.
- Preserved behavior: accepted-stop releases the idempotency key; a forced
  global stop (`/actions/stop` → `StopCurrent`) sends an accepted run through
  stopping and the process stop and keeps its key, matching the pre-scope
  implementation; a failed MAA process stop leaves the run `stopping` in
  `StopCurrent`; the `webrtc_start` terminal special case stays in
  `/actions/stop`; manual session cleanup still precedes the waiting-run stop.
- Added `TestRunLifecycleStaysInAgentRunScope` (archguard) plus lifecycle,
  manual-settle, stop-escalation, concurrent-stop, and concurrent-idempotency
  tests in `agentrun`; ran `go test -race` on `agentrun`, `maa`, `app`, and
  `agentapi`.
- Verified: full Go test suite (701 tests / 49 packages), vet, gofmt;
  `agentrun` + `maa` + `app` + `agentapi` under `-race`.
- Follow-up: two settle paths still discard persistence errors, matching the
  previous transport behavior (G13).

### Round 32 — jsval JSON contracts and three package migrations (2026-11-28, `b9c8f39`)

- G1a: `drops`, `notifications`, and `infra/maa/results` each carried a full
  private coercion set with subtly different null, array, and finite-number
  rules; the differences prevented a mechanical rename.
- Extended `internal/util/jsval` with the contracts those readers actually
  need: `StringJSON` (nil is JSON null → `"null"`, arrays join with null
  entries empty, objects render `"[object Object]"`), `FiniteNumber`
  (`Number(value)` with null → 0 and non-finite results rejected), and
  `FiniteNumberOrZero`. `FormatFloat` now follows the JavaScript decimal /
  exponential thresholds and normalizes exponents (`1e-7`, not `1e-07`), so
  the notifications-local formatter became redundant.
- Migrated all three packages to the canonical helpers and deleted their local
  `asRecord`, `truthy`, `jsString`, `stringValue`, `stringOrEmpty`,
  `numberValue`, `numberOrZero`, `joinStringValues`, `truthyString`,
  `formatJSNumber`, `normalizeExponent`, and `formatID` copies (~400 lines).
- Domain helpers that are not JS coercions stayed, with comments: drops
  `coalesceValue`/`asAnySlice`, notifications `itemTask`/`errMessage`/
  `formatTelegramTime`, MAA results `hasField`/`lookupNumber`.
- Behavior notes: notification IDs and tokens now stringify through
  `jsval.StringJSON` (textual JSON numbers keep their digits); tiny/large
  floats render with JavaScript exponents everywhere.
- Verified: full Go test suite (704 tests / 49 packages), vet, gofmt.
- Follow-up: G1b (gamedata, recognition, training, customtools) and G1c
  (mastery, scheduler, updates, run_resume, agentapi) hold the remaining
  copies.

### Round 33 — jsval contracts for readers, three more packages (2026-11-28, `f0f5af3`)

- G1b: the audit showed two opposite nil conventions. Document readers treat
  nil as JSON null (`Number(null) == 0`), while absence-aware services treat
  nil as undefined. `FiniteNumber` now means `Number.isFinite(Number(value))`
  with nil as undefined; added `FiniteNumberOrNull` for the document-reader
  convention. Also added `Numeric` (`typeof value === "number"`), `TextOK`
  (type assertion that keeps present-empty distinct), and corrected `Truthy`
  for numbers that overflow to ±Infinity (truthy in JavaScript) and NaN
  (falsy).
- Migrated `infra/gamedata` (7 files, ~80 call sites) and deleted its
  `asRecord`/`asArray`/`asArrayOK`/`truthy`/`jsString`/`jsNumber`/
  `numericValue`/`stringValue` copies; `firstTruthy`, `parseIntJS`,
  `roundToFixed4`, and `dateOnly` remain as domain helpers.
- Migrated `recognition` (coercion file reduced to the depot iteration-order
  helpers) and `customtools` (`stringValue` → `jsval.Text`).
- Behavior notes: gamedata now treats NaN as falsy and rejects non-finite
  numeric candidates, matching the documented JS rules; no reader output
  shape changed.
- Verified: full Go test suite (705 tests / 49 packages), vet, gofmt.
- Follow-up: G1b remains `training` (absence-aware semantics); G1c holds the
  mixed domain/coercion files.

### Round 34 — finish the G1b readers with training (2026-11-28, `b76f6b5`)

- `training` carried its own finite-number, numeric-only, string, and truthy
  helpers. Its nil semantics (absent property is not finite) now match
  `jsval.FiniteNumber`, so the four bodies were deleted outright:
  `toFiniteNumber` → `FiniteNumber`, `jsonNumberValue` → `Numeric`,
  `jsStringApprox` → `StringOrNullish`, `isTruthy` → `Truthy`;
  `settingString` now uses `TextOK`.
- Kept three documented domain adapters: `asRecord` (also accepts the
  `TrainingSettings` map type), `asArray`, and `numberOr` (finite number with
  a caller fallback).
- Behavior notes: float32 NaN is no longer numeric/truthy (JavaScript NaN is
  falsy), and small/large floats now use JavaScript formatting; training
  values are small integers, so rendered strings are unchanged.
- Verified: full Go test suite (705 tests / 49 packages), vet, gofmt.
- Follow-up: G1c holds the last mixed domain/coercion files.

### Round 35 — typed operbox/depot readers (2026-11-28, `6aafe63`)

- G3: training and mastery each decoded `operbox.json`/`depot.json` into
  untyped maps and re-derived the same field names; the `/data/operbox` and
  `/data/depot` endpoints returned the file verbatim.
- Added `snapshot.DecodeOperBox`/`DecodeDepot`: typed decoding that keeps
  `json.Number` values (depot counts, raw operator payloads) and documents the
  legacy `operators` list as an optional compatibility field.
- Migrated the training and mastery loaders to the typed documents; deleted
  training's per-field map lookups, mastery's dead `allFields=false` branch,
  and the untyped `allOpers` decode. The `/data` endpoints return the typed
  shape and fall back to the stored value only when an older document does not
  decode.
- Activity keeps its raw-document own-flag heuristic: it intentionally
  distinguishes an absent `own` key from `false`, which the typed
  `OperBoxRecord` cannot express; recorded as an exception, not a migration
  target.
- Added decode tests (including `json.Number` preservation) and endpoint tests
  for the typed shape plus the legacy fallback.
- Verified: full Go test suite (709 tests / 49 packages), vet, gofmt.
- Follow-up: G2 (one PRTS client) is the next P1.

### Round 36 — one PRTS transport (2026-11-28, `4071678`)

- G2: activity and copilot each carried HTTP request construction, a
  per-attempt timeout, status handling, JSON decoding, and a retry loop with a
  context-aware sleep. The only intentional difference was the backoff
  schedule (250 ms × attempt vs 500 ms × attempt), which PD5 has not decided.
- Added `internal/infra/prts.Client` with `Do`, `DoWithRetry`,
  `DoWithRetryFunc` (application-level status codes can join the retry
  decision), `RetryPolicy`, `StatusError`, and `SleepContext`.
- Both service clients now delegate: removed activity's `fetchJSON`,
  `httpStatusError`, and `sleepContext`, and copilot's `doJSONOnce`, both
  private retry loops, and its sleep helper. Envelope parsing, error wrapping,
  level caching, and stage-stat URLs stay with their services.
- Retry behavior is unchanged: activity passes 250 ms × attempt, copilot
  500 ms × attempt. Choosing the canonical schedule remains PD5.
- Error text now uses `HTTP <status>` from the shared `StatusError`; copilot's
  previous double "作业站请求失败" prefix is gone. No test depended on either.
- Added transport tests: number-preserving decode, status errors, policy
  delays, sleep cancellation, application-level retries, and JSON bodies.
- Verified: full Go test suite (715 tests / 50 packages), vet, gofmt.
- Follow-up: G6 (assets router) and C5 (client run projection) are the
  remaining P1 items; PD5 still needs a product decision.

### Round 37 — assets router into transport (2026-11-28, `25fb94d`)

- G6: `infra/assets` owned the mux, path-value parsing, raw JSON errors, image
  cache headers, and WebP negotiation in addition to resolution and encoding,
  so an infrastructure package imported routing.
- Split it: `infra/assets.Service` resolves normalized item/avatar keys to PNG
  paths and returns a WebP variant only when it is smaller (cache and encoder
  stay there); `transport/assetsapi` owns the mux, key validation, status
  mapping, cache headers, and `http.ServeContent`.
- Updated the composition root to hold the service and both entry points mount
  `assetsapi.New`. The raw-image contract is unchanged: same status codes, JSON
  error bodies, `Vary`/`Cache-Control`, PNG/WebP selection, and mount prefix.
- Split the tests with the code: pure resolution/cache/encoder tests stay in
  `infra/assets`; routing, traversal, and WebP response tests moved to
  `transport/assetsapi`.
- Extended `TestAppLayerHasNoHTTPHandlers` into
  `TestHTTPHandlersStayInTransport`, which now scans both app and infra; this
  was the last known infra handler, so the "not yet enforceable" note is gone.
- Verified: full Go test suite (716 tests / 51 packages), vet, gofmt.
- Follow-up: C5 (client run projection) is the last P1 item.

### Round 38 — derive page run state from the projection (2026-11-28)

- C5a: CombatTasks and RoguelikeTasks each owned a local `isRunning` flag that
  was written both by their submit flow and by `useTaskRestoreMonitor`, so a
  task started in another tab or before a refresh depended on the legacy
  `/tasks/status` poll.
- Added `AgentRun.metadata` to the client DTO type, a pure `selectOwnedRun`
  selector (operation id or server `taskType`, optional "waiting is idle" for
  manual copilot sets), and the `useOwnedRunActive` hook.
- CombatTasks and RoguelikeTasks now render `isSubmitting || runIsActive`:
  their local flag is renamed to `isSubmitting` and only covers the in-flight
  request; the global projection supplies restore and cross-page visibility.
  A waiting manual set stays idle so the continue action remains available.
- `useTaskRestoreMonitor` still supplies status messages and the global active
  flag; retiring its running writer and migrating AutomationTasks/
  DataStatistics is C5b, where PD3's polling decision applies.
- Added selector tests and a page test that a projected combat run renders the
  stop action while a waiting manual run does not.
- Verified: client type-check, lint at the ratchet, full suite (525 tests / 78
  files), and production build.
- Follow-up: C5b; the remaining P2/P3 pool is unchanged.

### Round 39 — finish the jsval migration (2026-11-28, `7ba6d9b`)

- G1c: `mastery`, `scheduler`, `updates`, `app/run_resume`, `agentapi`, and
  `quotes` still carried the last coercion bodies. Mapped each helper onto
  `jsval` and deleted the bodies:
  - mastery: `numberValue` → `FiniteNumberOrNull`, `stringify` →
    `StringOrNullish`; `asRecord`/`asArray`/`integerValue` and the fallback
    helper are thin adapters now.
  - scheduler: deleted `truthy`/`jsString`/`numericValue`; kept
    `configuredNumber` (a blank string means "not configured", unlike
    `Number("")`), with field accessors delegating to `Text`/`Record`.
  - updates/quotes: deleted their `truthy`, `textValue`, and `jsString`
    copies; `recordValue`/`stringValue`/`orDefault` delegate.
  - `run_resume`: `numberValue` → `jsval.Numeric`; this also makes the resumer
    read the persisted `json.Number` progress instead of silently ignoring it.
  - agentapi: deleted `numberValue`/`scalarText`/`anySlice`; `stringField`,
    `mapField`, `intField`, and `intSlice` delegate to jsval.
- C5b (the remaining page-state derivation) moved under PD3: its last step
  changes restore/polling semantics and needs the product decision.
- Verified: full Go test suite (716 tests / 51 packages), vet, gofmt.
- Follow-up: the Go pool is now G12/G13/G5/G10; client risk work remains in
  C7/C10/C11/C8/C9.

### Round 40 — one HTTP client factory (2026-11-28, `84a37ca`)

- G5: nine production sites built `&http.Client` with per-site timeouts, so a
  transport or proxy change would have to find them all.
- Added `internal/infra/httpclient` (`New(timeout)`, `Default`) and migrated
  gamedata, PRTS, activity, skland, and notifications. Retry policy stays with
  the endpoint owner; PRTS remains the only retrying transport.
- Added `TestHTTPClientsComeFromTheFactory`, which rejects direct
  `&http.Client{` construction outside the factory.
- Verified: full Go test suite (717 tests / 52 packages), vet, gofmt.
- Follow-up: G10 (bootstrap dedupe) and G12 (route coverage) are the remaining
  Go P2 items.

### Round 41 — one HTTP bootstrap for both entries (2026-11-28, `9ab8549`)

- G10: `cmd/server` and the MyGo desktop entry each constructed the signaling
  server and the same four handler mounts; only the desktop auth token
  differed, so a new shared handler could be added to one entry and not the
  other.
- Added `transport/bootstrap.ServerOptions`: it builds the signaling server
  and the agent/quotes/assets mounts; entries append their own options (the
  desktop token source).
- Added `TestEntriesShareTheHTTPBootstrap` so both entries keep using it.
- Verified: full Go test suite (718 tests / 53 packages), vet, gofmt.
- Follow-up: G12 (route coverage) is the last Go P2 item.

### Round 42 — raise Agent API route coverage (2026-11-28, `899643a`)

- G12: handler tests exercised about 18 of the 107 registered routes, so a
  broken registration or envelope on a read-only endpoint could ship.
- Added table-driven coverage for 21 read-only routes (config/profile,
  notification config, logs, drops, training, schedules, stages, custom tools,
  WebRTC/Skland/mastery status) plus lifecycle tests for user config,
  notification config, and log clearing. The mastery catalog's missing-data
  path is asserted as a stable 503 instead of a success.
- Route coverage is now ~45 of 107; remaining routes are mutation or
  device-side-effect operations covered indirectly by their service tests.
- Verified: full Go test suite (743 tests / 53 packages), vet, gofmt.
- Follow-up: the remaining pool is client-heavy (C7/C10/C11/C8, C9) plus G13
  and T5.

### Round 43 — skeletons next to their pages, part one (2026-11-28, `2ea1984`)

- C10a: `common/Loading.tsx` held both the spinner and every page skeleton,
  including a dashboard block that needs the dashboard layout hook.
- Extracted the shared `Skeleton` primitive and `PageHeaderSkeleton` into
  `common/Skeleton.tsx`; moved `DashboardSkeleton` (with its summary cards)
  next to `Dashboard.tsx` and updated the page/test imports.
- `Loading.tsx` keeps the spinner and the remaining page skeletons; C10b moves
  those and removes the `fields.tsx` test-only DOM branches.
- Verified: client type-check, lint at the ratchet, full suite (525 tests / 78
  files), and production build.
- Follow-up: C10b, then C7/C11/C8.

### Round 44 — page skeletons next to their pages (2026-11-28, `4c4da1b`)

- C10b: the remaining seven page skeletons lived in `common/Loading.tsx`
  together with the spinner.
- Moved every page skeleton next to its page (`AutomationTasksSkeleton`,
  `CombatTasksSkeleton`, `RoguelikeTasksSkeleton`, `OperatorTrainingSkeleton`,
  `LogViewerSkeleton`, `DataStatisticsSkeleton`, `ConfigManagerSkeleton`);
  shared panel/monitor/mode primitives live in `common/Skeleton.tsx`, and
  `components/PageSkeleton.tsx` dispatches the variants. `Loading.tsx` is now
  only the spinner; the common barrel no longer exports `PageSkeleton`.
- Updated `App`, the dashboard skeleton test, and the page/backend test mocks
  to the new module boundaries.
- `fields.tsx` still has the jsdom-only native select/checkbox branches; they
  need a dedicated test-harness change, recorded as C10c.
- Verified: client type-check, lint at the ratchet, full suite (525 tests / 78
  files), and production build.
- Follow-up: C7/C11/C8 remain, then C9/C10c.

### Round 45 — extract AutomationTasks schedule helpers (2026-11-28, `13dd8bf`)

- C11a: `AutomationTasks.tsx` inlined the schedule-time grammar: validation,
  dedupe, parse/clamp, entry normalization, legacy `times` fallback, and active
  filtering.
- Moved them to `utils/automationSchedule.ts` with unit tests for invalid
  times, dedupe, clamping, legacy shapes, and enabled filtering. The page keeps
  `RunElapsed` and the task-param adapters; only the schedule functions moved.
- Verified: client type-check, lint at the ratchet, full suite (530 tests / 79
  files; one unrelated timing flake on the first run passed on rerun), and
  production build.
- Follow-up: C11b (Dashboard helpers), then C7/C8.

### Round 46 — extract Dashboard payload helpers (2026-11-28, `deead36`)

- C11b: `Dashboard.tsx` inlined record guards, first-string selection,
  timestamp validation, stage-array validation, activity-completion
  validation/normalization, and the usage threshold classes.
- Moved them to `utils/dashboardData.ts` with tests for malformed payloads,
  the stage limit, completion normalization, and threshold classes. The page
  keeps the store/API orchestration.
- Verified: client type-check, lint at the ratchet, full suite (535 tests / 80
  files), and production build.
- Follow-up: C7 (API module split) and C8 (color tokens) are the remaining P2
  client items.

### Round 47 — split the API client core (2026-11-28, `6d5d7b8`)

- C7a: `services/api.ts` mixed the HTTP core (base URL, auth headers, raw
  fetch, icon URL) with every endpoint method.
- Moved the core to `services/api/client.ts`; `api.ts` imports and re-exports
  `API_BASE_URL`, `fetchWithAuth`, and `getItemIconUrl`, so existing imports
  keep working. `getAuthHeaders` stays internal to the client but is exported
  for the one custom-header request.
- Updated `apiBoundary.test.ts` to allow the new client module while still
  rejecting raw fetch everywhere else.
- Verified: client type-check, boundary test, lint at the ratchet, full suite
  (535 tests / 80 files), and production build.
- Follow-up: C7b splits the endpoint methods into domain modules.

### Round 48 — split the endpoint tail into domain modules (2026-11-28, `47e3511`)

- C7b: the mastery, Skland, copilot-search, and drops endpoints were the last
  standalone block in `services/api.ts`, each repeating URL construction and
  response parsing.
- Moved them to `services/api/mastery.ts`, `skland.ts`, `copilotSearch.ts`,
  and `drops.ts`; `api.ts` re-exports every function so page imports and test
  mocks keep working. Removed the now-unused type imports from the facade.
- Verified: client type-check, boundary test, lint at the ratchet, full suite
  (535 tests / 80 files), and production build.
- Follow-up: C7c moves the `maaApi` object, training/notification endpoints,
  and shared local types.

### Round 49 — split the notification API (2026-11-28, `1540d5e`)

- C7c: notification config types, the clone helper, the shared cache, and
  `notificationsApi` lived inside `services/api.ts` next to every other
  endpoint.
- Moved them to `services/api/notifications.ts`; the facade re-exports the
  types and API object so `NotificationSettings` and its tests keep importing
  from `@/services/api`.
- Verified: notification settings test, boundary test, type-check, lint at the
  ratchet, full suite (535 tests / 80 files), and production build.
- Follow-up: C7d moves the training endpoints and the `maaApi` object.

### Round 50 — split the training API (2026-11-28, `2b57ee6`)

- C7d: the training/operbox endpoint functions and their request/response
  types were still defined in `services/api.ts`.
- Moved them to `services/api/training.ts`; the facade re-exports the
  functions and the public response types. Restored `LogFileContentData` and
  `CopilotSetInfo`, which the range move had clipped, and removed the unused
  type imports.
- Verified: training/statistics tests, boundary test, type-check, lint at the
  ratchet, full suite (535 tests / 80 files), and production build.
- Follow-up: C7e composes `maaApi` from domain modules.

### Round 51 — move maaApi behind the API facade (2026-11-28, `86e2d34`)

- C7e: after the endpoint modules moved out, `services/api.ts` still carried
  the 600-line `maaApi` object and all of its DTOs.
- Moved the object and DTOs to `services/api/maa.ts`; `services/api.ts` is now
  a 63-line facade that re-exports `maaApi`, the client core, and every domain
  module. Existing `@/services/api` imports and test mocks are unchanged.
- Verified: client type-check, lint at the ratchet, full suite (535 tests / 80
  files), and production build.
- Follow-up: C7f splits `maa.ts` by domain and composes the object.

### Round 52 — extract the API DTOs (2026-11-28, `69fe741`)

- C7f: `services/api/maa.ts` mixed the maaApi object with every local DTO.
- Moved the DTO block to `services/api/types.ts`; `maa.ts` imports the types
  it uses and the facade re-exports them, so `@/services/api` type imports are
  unchanged. Removed the unused imports left in both files.
- Verified: client type-check, lint at the ratchet, full suite (535 tests / 80
  files), and production build.
- Follow-up: C7g splits the maaApi method groups and composes the object.

### Round 53 — start composing maaApi from groups (2026-11-28, `5d0686b`)

- C7g (first slice): the version/config-directory and command-execution
  methods moved to `services/api/groups/system.ts` as `systemApi`; `maaApi`
  now spreads it and keeps the remaining groups.
- Moved the group's DTO imports with it and removed them from `maa.ts`.
- Verified: client type-check, lint at the ratchet, full suite (535 tests / 80
  files), and production build.
- Follow-up: move logs/config/connections/activity/schedule/updates/user
  config/data/copilot/custom-tools/WebRTC groups the same way.

### Round 54 — finish the maaApi group split (2026-11-28, `13d0cc8`)

- C7g: moved the remaining `maaApi` groups to `services/api/groups/`:
  `logs`, `config` (including user config), `connections` (device/WebRTC/
  clipboard/screen), `activity`, `schedule`, `updates`, and `data`
  (recognition/copilot/custom tools).
- `services/api/maa.ts` is now a 30-line composition of the group objects;
  the facade and all `@/services/api` imports are unchanged.
- Verified: client type-check, lint at the ratchet, full suite (535 tests / 80
  files), and production build.
- Follow-up: C8 (color tokens) is the last P2 item.

### Round 55 — migrate JS color literals to theme tokens (2026-11-28, `d1b8061`)

- C8: eight files still carried hex/RGB literals even though the themes expose
  semantic tokens, and the status pulse used fixed light-theme RGB values in
  dark mode.
- Added `--app-on-accent` and per-theme `--app-*-rgb` / `--app-text-soft-rgb`
  tokens to `index.css` and `ios-theme.css`; migrated the dashboard action
  labels, preview buttons, focus ring, switch default, StatusMark defaults,
  ASCII backdrop, `useThemeAccent`, and the browser theme-color meta to read
  those tokens (the meta now follows the effective `--app-bg`).
- The color-boundary allowlist now contains only `CustomTools.tsx`: its
  40-hue palette is a user-selectable feature, so narrowing it is a design
  decision recorded as PD6. T6 (GlassNav/GlassMenu design references) also
  moved to PD7.
- Visual verification: isolated backend (port 3010, temp data dir) + Vite
  (5174), headless Chrome via CDP with seeded themes; checked the dashboard at
  1440×900 and 390×844 in light and dark. Action text, status dots, preview
  surfaces, and the island accent render correctly in both themes.
- Verified: client type-check, lint at the ratchet, full suite (535 tests / 80
  files), and production build.
- Follow-up: P3 pool remains (G13, C9, C10c, T5); PD6/PD7 wait for decisions.

### Round 56 — surface terminal persistence failures (2026-11-28, `c3feec1`)

- G13: `Scope.Execute` and `Settle` discarded a failed terminal write and
  returned the action error, and the accepted-stop path ignored a failed
  idempotency release. A client could see a normal error while the store still
  held an active run or a replayable key.
- Decision: a terminal write that cannot be persisted fails the request. The
  scope now returns the persistence error from `Execute`, `Settle`, and the
  accepted-stop release; the handler maps it to the existing 503 envelope.
- Added tests that break the store path mid-action and assert the persistence
  error code instead of the action error.
- Verified: full Go test suite (745 tests / 53 packages), vet, gofmt.
- Follow-up: C9/C10c/T5 remain.



















### Round 57 — share base-path fixtures (2026-11-28, `2cd8d7f`)

- T5: the Go server and the Vite build each normalized a configured deployment
  path with their own inline test cases.
- Added `testdata/base-path-fixtures.json`; both `config_test.go` and
  `vite.config.test.ts` read the same cases (empty/root, leading slash, trailing
  slash, whitespace, internal double slash).
- Verified: Go config test, Vite config test, full Go suite, and the client
  build.
- Follow-up: C10c and C9 remained.

### Round 58 — remove the jsdom-only form branches (2026-11-28, `a8faaa5`)

- C10c: `fields.tsx` rendered native select/checkbox DOM only when
  `import.meta.env.MODE === 'test'`, so production and tests exercised
  different component trees.
- Added a vitest setup harness that replaces `GlassSelect`,
  `GlassSelectWithFill`, and `GlassCheckbox` with accessible native controls
  carrying the same value/checked contracts and native control classes. Removed
  both test branches from `fields.tsx`; the real component path now runs in
  tests.
- Updated the two tests that asserted the deleted wrapper/trailing-icon DOM and
  removed the now-redundant per-test AutomationTasks glass mock.
- Verified: client type-check, lint at the ratchet, full suite (535 tests / 80
  files), and production build.
- Follow-up: C9 (page CSS split) is the last actionable task.

### Round 59 — page CSS split blocked on skeleton ownership (2026-11-28)

- C9: moving page-prefixed rules out of `index.css` looked mechanical, so the
  logs set was migrated as a trial: 46 rules (including their media contexts)
  moved to `src/styles/pages/logs.css`, and the live logs page matched the
  baseline pixel-for-pixel in light/dark desktop and mobile (only the rotating
  status quote differed).
- The trial exposed a coupling the task did not account for:
  `LogViewerSkeleton` (and the other page skeletons) reuse the page's
  structural classes and render before the lazy route CSS is imported, so
  their loading state depends on the base rules in `index.css`. Several
  `automation-*` classes are also shared by notification/training/dashboard
  components, so a prefix-based move would strip their styling on other pages.
- Decision: do not move the rules until the design system owns the skeleton
  styling strategy. The trial changes were reverted; the working tree keeps
  the original `index.css` and `logs.css`. Recorded as PD8 (choose
  self-contained skeleton CSS, eager skeleton CSS, or a documented base-layer
  exception).
- Verified: reverted files match HEAD; no production change this round.
- Follow-up: PD8; all other actionable tasks are complete.

### Round 60 — resolve the blocked decisions (2026-11-28, `93fb102`)

- PD5 (implemented): activity now retries at 500 ms × attempt, matching
  copilot; both use three attempts. ADR-0003.
- PD3 (rejected): page run state stays a projection/local hybrid. The
  projection owns server-run identity and cross-page state; pages keep flags
  for their own in-flight request and client workflows. C5b is closed without
  changing polling. ADR-0004.
- PD6 (accepted): the CustomTools 40-hue palette is user content, not theme
  color; it stays in the color allowlist as a documented exception. ADR-0005.
- PD7 (accepted): DESIGN's `GlassNav`/`GlassMenu` refer to the app adapters in
  `LayoutGlassChrome.tsx`; documented there and in DESIGN. ADR-0006.
- PD8 (accepted, C9 rejected): page-prefixed base rules stay in `index.css`;
  the earlier logs trial matched the live page but left skeletons unstyled,
  which `DESIGN.md` already forbids. ADR-0007.
- Updated `DESIGN.md` (adapter note, palette exception, skeleton import path)
  and the architecture deviation list. Remaining blocked items are PD1
  (workflow edits) and PD2 (token-layer visual system).
- Verified: full Go test suite (745 tests / 53 packages), vet, gofmt. Client
  changes are documentation-only this round.
- Follow-up: PD1 needs an explicit workflow request; PD2 needs a rendered
  design pass.

### Round 61 — CI guards and token-layer start (2026-11-28, `a4c38fa`)

- PD1: `go-verify.yml` gained a `gofmt -l` guard, a run-lifecycle `go test -race` job, and a client-verify job (Node 22, `npm ci` + `npm run verify`). The publish workflow is untouched; every job keeps `contents: read` and no secrets.
- PD2 phase 1: `ios-theme.css` now declares a `--la-*` primitive palette for
  blue/green/orange/amber/red/indigo, and the accent/success/warning/danger/
  info semantic tokens reference it. Alpha variants use `color-mix` against the
  same primitive; values are unchanged.
- Visual verification: isolated backend + Vite + headless Chrome; the
  dashboard at 1440×900 and 390×844 in light/dark matched the pre-change
  screenshots pixel-for-pixel in static regions (sidebar, buttons, surfaces),
  with only the dynamic clock/status quote differing.
- Remaining PD2 phases: surface/neutral primitives, spacing/radius primitives,
  component tokens (`--app-button-primary-bg`, `--app-card-radius`), and the
  `index.css` fallback layer.
- Verified: client production build (type-check included); CSS-only change.
- Follow-up: PD2 remainder and PD1 CI rollout observation.

### Round 62 — primitive surfaces, spacing, and component tokens (2026-11-28, `d650a2b`)

- PD2 phase 2/3: added neutral/surface (`--la-gray-*`, `--la-slate-*`),
  spacing (`--la-space-*`), radius (`--la-radius-*`), control
  (`--la-control-*`), and font-size primitives to the effective theme; the
  surface, border, text, radius, spacing, control, and tabbar semantic tokens
  now reference them. Alpha surfaces use `color-mix` against the same
  primitives.
- Added `--app-card-radius`, `--app-card-continuous-radius`,
  `--app-button-primary-bg`, and `--app-button-primary-text`; the shared card
  and `.brand-action` rules now use them.
- Visual verification: captured dashboard and automation pages at 1440×900
  and 390×844 in light/dark before and after the change. Static pixel samples
  (card surfaces, page background, button fill, sidebar) were identical; the
  remaining differences were the animated ASCII field, island progress, PWA
  prompt, clock, and rotating status quote.
- Remaining PD2 work: migrate the `index.css` fallback palette to primitives
  and replace the literals still inside component rules.
- Verified: client production build (type-check included).

### Round 63 — complete the token layers (2026-11-28, `cc49db6`)

- PD2 phase 4: added a self-contained `--la-base-*` primitive palette to
  `index.css` and rewired its fallback semantic tokens. Every remaining
  component-rule colour in both theme files (shadows, gradients, masks,
  overlays, contrast overrides) now references a primitive; alpha variants use
  `color-mix`.
- Added `src/styles/tokenLayerBoundary.test.ts`: colour literals are rejected
  outside `--la-*` / `--la-base-*` primitive definitions. The status pulse's
  `rgb(var(--status-pulse-rgb))` is the documented dynamic exception.
- Fixed two self-references introduced while replacing `#fff`/`#ffffff`
  tokens, then re-ran the visual comparison: static samples across dashboard
  and automation (light/dark, 1440×900 and 390×844) match the previous build;
  remaining differences are animated backdrop/island/PWA prompt/clock/status
  text.
- PD2 is complete; the blocked task pool is empty.
- Verified: client type-check, lint at the ratchet, full suite (536 tests / 81
  files), and production build.

### Round 64 — keep framer-motion out of the entry (2026-11-28, `760501c`)

- PF0 (implemented): the first-visit guide and the access-token dialog are
  lazy-loaded, so their modal animation dependency no longer ships with the
  dashboard. `AccessTokenGate` is now a tiny event listener; the dialog lives
  in `AccessTokenModal` and mounts after a 401. `OnboardingDialog` loads on
  first open and stays mounted for its close animation.
- `Modal`/`ConfirmDialog` and `StatusMark` left the `components/common`
  barrel and are imported from their files by their lazy consumers. The
  framer-motion manual chunk was removed: naming it pulled the vendor into
  the entry preload even though every consumer is a lazy page.
- Added an entry-chunk policy test to `vite.config.test.ts` so a future
  framer-motion manual chunk is caught before it reaches the entry.
- Bundle: entry 776.4 → 760.6 KB raw (255.3 → 250.5 KB gzip); initial JS is
  ~49 KB gzip smaller (44.6 KB motion-vendor + 4.8 KB entry). The PWA
  precache drops from 17 entries / 1,376.7 KiB to 16 / 1,237.1 KiB.
  Framer-motion now lives in an async shared chunk (114.7 KB raw / 37.1 KB
  gzip) loaded only when a page that animates is opened.
- Visual verification: the onboarding dialog rendered in light/dark at
  1440×900 and 390×844; the access-token dialog rendered in light/dark at
  1440×900. Both keep their existing layout, focus, and close behavior.
- Verified: client lint (0 errors, 1 existing warning), type-check, full
  suite (537 tests / 81 files), production build, and the new config test.
- Follow-up: PF1–PF6 in `TASKS.md` (three.js glass runtime, island,
  WebRTC preview, glass popups, unused run logs, CSS pruning).

### Round 65 — keep the glass renderer off the default dashboard (2026-11-28, `970eab5`)

- PF1a (implemented): `PreviewAutoStartToggle` now renders only when the
  preview mode is not `off`. The default dashboard previously mounted the
  glass switch, whose `useGlassCanvas` effect downloaded the three.js runtime
  (857 KB raw / 236 KB gzip) immediately after first paint.
- Added a regression test for both sides: preview `off` has no auto-start
  toggle; preview `live` still keeps it after the reconnect control.
- Runtime check with headless Chrome: the default dashboard makes no request
  matching `glass/runtime` or `three`. The remaining canvas elements are the
  2D ASCII backdrop, not the glass renderer.
- Visual check: dashboard at 1440×900 and 390×844 in light/dark; the preview
  header stays aligned with the status chip, and no toggle appears while
  preview is off.
- Verified: client lint (0 errors, 1 existing warning), type-check, full
  suite (539 tests / 81 files).
- Follow-up: PF1 (Automation/Config still mount the glass switch on page
  load) and PF2–PF6 in `TASKS.md`.

### Round 66 — gate the glass renderer behind first interaction (2026-11-28, `d197ded`)

- PF1b (implemented): `useGlassCanvas` no longer imports the three.js runtime
  on mount. A control loads it on its first `pointerdown`, `focusin`, or
  `keydown`; Switch and CheckboxField paint solid token-based fallbacks until
  then. The first control that loads the runtime broadcasts readiness, so
  every mounted canvas upgrades together instead of leaving a page with a
  mix of glass and fallback.
- The vendored canvas hook is a documented local patch in
  `components/glass/README.md`; the solid fallback contract is recorded in
  `DESIGN.md`. Tests cover the fallback DOM, the no-load-before-interaction
  behavior, and the one-load-upgrades-all fan-out.
- Runtime checks with headless Chrome: Automation, Config, and Combat make no
  `glass/runtime` or `three` request after 5 s of idle. A focus or pointerdown
  loads the runtime once; all 3 Automation switches, both Config switches, and
  all 4 Combat checkboxes become ready. The fallback's computed opacity goes
  from 1 to 0 when the canvas reports `data-glass-ready`.
- Visual check: Automation at 1440×900 in light/dark and 390×844 light,
  Config at 1440×900 light, and the Combat advanced-settings checkboxes at
  1440×900 light/dark. Fallback and glass states keep the same track, knob,
  checked fill, and check mark.
- Verified: client lint (0 errors, 1 existing warning), type-check, full
  suite (543 tests / 83 files), and production build.
- Follow-up: PF2–PF6 in `TASKS.md` (island, WebRTC preview, glass popups,
  unused run logs, CSS pruning).

### Round 67 — lazy-load the dynamic island subsystem (2026-11-28, `e2a29f9`)

- PF2 (implemented): the island provider, surface, `RunIsland`,
  `MaaUpdateIsland`, `MasteryIsland`, `SanityBatteryIsland`, the islandcn
  visuals, and hugeicons now live in one `IslandLayer` chunk. `IslandHost`
  mounts it after the first animation frame; the layer is absolutely
  positioned, so the deferral causes no layout shift. `App` and `Layout` no
  longer import the island library or the activity adapters.
- Bundle: entry JS 760.6 → 564.3 KB raw (250.5 → 180.0 KB gzip). The island
  chunk is 191.1 KB raw / 61.0 KB gzip and is not precached; the PWA precache
  drops from 1,240.15 KiB to 1,047.52 KiB. Island and hugeicons sources are
  absent from the entry sourcemap.
- Runtime check: at 250 ms the island layer is absent; by 1.5 s it is mounted
  and shows the sanity pill. Desktop light/dark screenshots keep the header
  and page layout unchanged; the phone stage remains `display: none`, as
  before.
- Added `IslandHost.test.tsx` (mounts after the first frame) and
  `islandBoundary.test.ts` (App/Layout keep no island imports). Verified:
  client lint (0 errors, 1 existing warning), type-check, full suite
  (545 tests / 85 files), and production build.
- Follow-up: PF3–PF6 in `TASKS.md` (WebRTC preview, glass popups, unused run
  logs, CSS pruning).

### Round 68 — tree-shake the glass menu out of the entry (2026-11-28, `8b4a28d`)

- PF4 (implemented): glass and common component modules are marked
  side-effect-free in the Vite build, the common barrel no longer exports
  `CheckboxField`/`GlassSelectWithFill`/`SelectField`, and `LayoutGlassChrome`
  renders a same-style trigger that lazy-loads `GlassMenuImpl` on hover or
  activation. The real menu opens with focus on the first item; Escape returns
  focus to the trigger.
- Bundle: entry JS 564.3 → 237.4 KB raw (180.0 → 73.1 KB gzip). The full
  initial preloaded JS+CSS payload falls from ~286 KB to ~244 KB gzip because
  the entry's shared glass chunks are smaller; the PWA precache drops from
  1,047.5 KiB to 728.8 KiB. The menu chunk is 33.2 KB raw / 11.3 KB gzip and is
  not precached.
- The glass form fields and menu foundations are absent from the entry graph;
  only the core `GlassCard`/`GlassButton`/segmented chunks remain preloaded.
- Verified against the production preview build: the dashboard renders, the
  overflow menu opens from the placeholder on the first click, focus enters
  the menu, and Escape closes it and restores trigger focus. Screenshots cover
  the menu closed/open in light/dark at 390×844 and the Automation page in
  light/dark at 1440×900. Client lint, type-check, full suite (547 tests / 86
  files), and the production build pass.
- PF3 is recorded as blocked in `TASKS.md`: the App-level
  `PreviewSessionProvider` owns the only WebRTC session and quality-restart
  logic, so moving the preview entry requires a session-engine split.
- Follow-up: PF5/PF6, and a decision on the PF3 session refactor.
