# Governance Task Pool

Status: `todo`, `doing`, `blocked`, `done`. Priority reflects value ÷ risk;
a lower-priority item may still be blocked on a decision. Every task names the
evidence and the canonical target so it can be picked up by a parallel agent
without re-investigation.

## Next up

| ID | P | Area | Task | Evidence |
| --- | --- | --- | --- | --- |
| G1 | P1 | go | Finish the `internal/util/jsval` migration: `drops`, `scheduler`, `notifications`, `updates`, `quotes`, `gamedata`, `maa/results`, `mastery`, `recognition`, `training`, `customtools`, `run_resume`, `agentapi` still carry local copies | `internal/util/jsval` now serves `activity` and `copilot`; compare each remaining helper body before mapping (`asString` is a type assertion → `jsval.Text`, not `jsval.String`) |
| G3 | P1 | go | Typed schemas for `operbox.json` and `depot.json` so the writer and readers share field definitions | `recognition/service.go` writes `OperBoxOutput`/`DepotOutput`; `training/data.go:212,293`, `mastery/data.go:107,112`, `handler.go:1849,1858` read untyped maps. Paths and filenames are now owned by `config.Paths` |
| G2 | P1 | go | One PRTS client in `internal/infra/prts`; unify retry/timeout semantics | `activity/prts.go:50-223` vs `copilot/prts.go:73-473` |
| G11 | P1 | go | Move the remaining service-level env reads into `internal/config` (`MAA_CLI_PATH` in mastery/updates/main, battle OCR, mastery tick, asset WebP concurrency, scrcpy path/version) | ADB defaults are now shared and every variable is documented; the remaining reads bypass the config SSOT |
| G12 | P2 | go | Raise `agentapi` route coverage beyond the current ~18 of 107 paths | `handler_test.go` exercises ~18 distinct routes; contract tests cover the registry, not handler behavior |

## Larger refactors

| ID | P | Area | Task | Evidence / risk |
| --- | --- | --- | --- | --- |
| G6 | P1 | go | Move `quotes`/`assets` HTTP handlers into `transport/` and use `httpx` for every response | 4 envelope implementations; `app/quotes/handler.go:38`, `infra/assets/handler.go:84` |
| G7 | P1 | go | Give `app/agentrun` a run scope so transport only decodes/validates/delegates | `handlers_runs.go`, `handlers_copilot.go`, `handlers_schedule.go` still call begin/start/fail/stop; 5 lifecycle writers; high risk |
| G5 | P2 | go | Shared HTTP client/retry factory | 10 `&http.Client{...}` sites; retries only in PRTS |
| G10 | P2 | go | One bootstrap for desktop and headless mounts | `go/main.go:277-289` vs `cmd/server/main.go:40-50` |
| C5 | P1 | client | Derive page `isRunning` from the global run projection; keep local state only for submit-in-flight | four local flags; `statusStore.runStatus` + `runStore` already project runs; behavior-sensitive |
| C7 | P2 | client | Split `services/api.ts` into `api/client.ts` + endpoint modules; unify `maaApi` and standalone exports | 1,305 lines, 89 calls, 37 standalone functions |
| C10 | P2 | client | Complete the common barrel; move page skeletons next to pages; remove env-specific DOM branches | `Loading.tsx` 967 lines; 11 deep imports; `fields.tsx:64,172` test-only branches |
| C11 | P2 | client | Extract pure helpers from giant pages | `AutomationTasks.tsx:29-150,283,1745-1785`; `Dashboard.tsx:146-300,348-378` |
| C8 | P2 | client | Token/color migration for the remaining literals; fix `statusMessage` pulse RGB against the effective iOS theme | `utils/statusMessage.ts:11-33`; ~8 production hex sites; visual verification required |
| C9 | P3 | client | Move page-prefixed CSS out of `index.css` into route CSS | 13 class names defined twice; visual verification required |
| T5 | P3 | toolchain | Shared base-path normalization fixtures consumed by Go and Vite tests | duplicated normalization in `config.go:88-103` and `vite.config.ts:14-20` |
| T6 | P3 | client | Reconcile DESIGN references to `GlassNav`/`GlassMenu` with the actual Layout composition | `DESIGN.md:89,700-712`; decide implement vs doc, needs design call |

## Blocked / pending decision

| ID | Decision | Why blocked |
| --- | --- | --- |
| PD1 | Add client verify/gofmt/race jobs to `.github/workflows` | `AGENTS.md` forbids workflow edits without an explicit request; record and wait |
| PD2 | Implement the primitive/semantic/component token layers from `DESIGN.md` | Visual system change; needs rendered light/dark/mobile verification |
| PD3 | Make the global run projection the only owner of page run state | Changes polling and keep-alive semantics; needs product confirmation |
| PD4 | Move run lifecycle out of transport (G7) | Large behavioral refactor; needs a dedicated round with race/cancellation tests |
| PD5 | Choose one PRTS retry contract (activity starts at attempt 0, copilot at 1) | Product-visible retry count; pick canonical semantics first |

## Completed

- Contract baselines for `httpx`, `errors`, `domain/agentrun` (`c911baf1`).
- Executable Go layer guard (`3ee740f0`).
- Contract-operation → route guard (`f39b6d24`).
- Duplicate atomic writer, `MAAServiceService`, second `Profiles` removed (`d2c385e5`).
- Docker detection no longer depends on `NODE_ENV` (`1e22c858`).
- Dead `uibrik` background deleted, stale README rewritten (`d7736830`).
- Client lint ratchet + verify dedupe (`e4843dda`).
- Glass adapter boundary restored and enforced (`ffed77d2`).
- Duplicated run-restore/poll effect extracted to `useTaskRestoreMonitor` with hook tests.
- Shared duration/timestamp/error formatters in `utils/format.ts` and `utils/errorMessage.ts`; local copies deleted.
- Notification config API, cache, and types moved into `services/api.ts`; `AutoUpdateConfig` duplication removed.
- All Zustand stores consolidated under `src/state/` with one barrel; ~50 imports migrated.
- `internal/util/jsval` created; `activity` and `copilot` local coercion copies deleted.
- `internal/util/timefmt` created; all API timestamp and date layout literals migrated.
- Docs drift fixed (action count, state path, Docker ADB, go/README verify, PLAN stale entries); root package renamed.
- `LA_PLUMA_MAX_REALTIME_LOGS` implemented and documented; buffer size now config-owned.
- Storage filenames and the `user-configs` path owned by `config.Paths`; seven packages migrated.
- Config sync token/queue/pending-key protocol centralized in `utils/configSync.ts`; three task pages migrated.
- `internal/app/logs` and the composition root now have direct tests.
- Notifications and WebRTC use the shared platform-aware connection defaults; every environment variable is documented.
- `agentapi/handler.go` split into 15 domain files (3,450 → 775 lines); file-size guard added.
