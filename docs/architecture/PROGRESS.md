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


















