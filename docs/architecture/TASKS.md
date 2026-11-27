# Governance Task Pool

Status: `todo`, `doing`, `blocked`, `done`. Priority reflects value ÷ risk;
a lower-priority item may still be blocked on a decision. Every task names the
evidence and the canonical target so it can be picked up by a parallel agent
without re-investigation.

## Next up

| ID | P | Area | Task | Evidence |
| --- | --- | --- | --- | --- |
| C2 | P0 | client | One module for duration/timestamp/error formatting (`lib/format.ts`, `lib/errors.ts`) | `utils/runIsland.ts:114`, `CombatExecutionProgress.tsx:4`, `AutomationTasks.tsx:65`, `MasteryTrainingWorkspace.tsx:100,104,133`, `NotificationSettings.tsx:55`, `LogViewer.tsx:125` |
| C3 | P0 | client | Move the notification API out of `NotificationSettings.tsx` into `services/api.ts`; merge the duplicated `AutoUpdateConfig` | `NotificationSettings.tsx:30-90,67,169,205`; `api.ts:90` vs `types/components.ts:338` |
| C4 | P1 | client | Consolidate `store/` + `stores/` into one `src/state/` module with one barrel; migrate all imports | 46 imports to `store/`, 20 to `stores/`; 25 relative deep imports |
| G1 | P1 | go | Canonical JS-coercion helpers in `internal/util/jsval`; migrate one package per commit | `truthy`×8, `asRecord`×8, `numberValue`×8 across 12 packages |
| G4 | P1 | go | One timestamp format constant and one timezone helper | literal `"2006-01-02T15:04:05.000Z"` in 10 files; 3 zone strategies |
| G3 | P1 | go | Typed owners for `operbox.json`, `depot.json`, and the `user-configs` path | written in `recognition/service.go:188,267`; read in `mastery/data.go:107,112`, `training/data.go:211,292`, `handler.go:1849,1858`; path composed in 7 packages |
| G2 | P1 | go | One PRTS client in `internal/infra/prts`; unify retry/timeout semantics | `activity/prts.go:50-223` vs `copilot/prts.go:73-473` |
| G9 | P1 | go | Tests for `internal/app/logs` and composition-root wiring; raise agentapi route coverage | only `app/logs` lacks tests; `app.New` covered indirectly |
| G11 | P1 | go | Read environment only in `internal/config`; document all vars and defaults | 17 undocumented vars; `MAA_CLI_PATH` read in 4 places; `ADB_PATH` hardcoded in `notifications/bot.go:186` |
| T2 | P1 | docs | Fix stale docs: 26 vs 40 actions, missing glass adapter (now fixed), stale paths, Docker ADB instructions, `go/README` verify | `README.zh.md:91`, `README.md:164`, `README.md:243,248`, `go/README.md:86-91` |
| T3 | P2 | config | Resolve the dead `LA_PLUMA_MAX_REALTIME_LOGS` comment: implement the option or delete the claim | `docker-compose.yml:30`; capacity hardcoded at `app.go:109` |
| T4 | P2 | toolchain | Rename the root package from `maa-prts` to `la-pluma` | `package.json:2` |

## Larger refactors

| ID | P | Area | Task | Evidence / risk |
| --- | --- | --- | --- | --- |
| G6 | P1 | go | Move `quotes`/`assets` HTTP handlers into `transport/` and use `httpx` for every response | 4 envelope implementations; `app/quotes/handler.go:38`, `infra/assets/handler.go:84` |
| G7 | P1 | go | Give `app/agentrun` a run scope so transport only decodes/validates/delegates | `handler.go:715-768`, `2955-3005`; 5 lifecycle writers; high risk |
| G8 | P2 | go | Split `agentapi/handler.go` by domain into files within the package | 3,450 lines, 158 funcs, 107 routes; do after G7 so ownership is real |
| G5 | P2 | go | Shared HTTP client/retry factory | 10 `&http.Client{...}` sites; retries only in PRTS |
| G10 | P2 | go | One bootstrap for desktop and headless mounts | `go/main.go:277-289` vs `cmd/server/main.go:40-50` |
| C5 | P1 | client | Derive page `isRunning` from the global run projection; keep local state only for submit-in-flight | four local flags; `statusStore.runStatus` + `runStore` already project runs; behavior-sensitive |
| C6 | P1 | client | One persisted-draft/sync module with per-domain adapters | three `*ConfigSyncPending` implementations; 84 raw `localStorage` references |
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
