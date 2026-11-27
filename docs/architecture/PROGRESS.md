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








