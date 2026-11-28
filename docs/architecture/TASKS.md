# Governance Task Pool

Status: `todo`, `doing`, `blocked`, `done`. Priority reflects value ÷ risk;
a lower-priority item may still be blocked on a decision. Every task names the
evidence and the canonical target so it can be picked up by a parallel agent
without re-investigation.

## Next up

| ID | P | Area | Task | Evidence |
| --- | --- | --- | --- | --- |
| G1c | P2 | go | Finish the `internal/util/jsval` migration in mixed domain/coercion files: `mastery`, `scheduler`, `updates`, `app/run_resume`, `agentapi` | These files mix JS coercion with domain field accessors; move only the coercion bodies and keep the accessors documented |
| G2 | P1 | go | One PRTS client in `internal/infra/prts`; unify retry/timeout semantics | `activity/prts.go:50-223` vs `copilot/prts.go:73-473` |
| G12 | P2 | go | Raise `agentapi` route coverage beyond the current ~18 of 107 paths | `handler_test.go` exercises ~18 distinct routes; contract tests cover the registry, not handler behavior |
| G13 | P3 | go | Surface persistence errors discarded by stop/settle paths | `agentrun.Scope.Stop` ignores `releaseIdempotency` errors and `Settle` ignores `fail` errors, matching the pre-scope transport; decide whether a failed terminal write must fail the request |

## Larger refactors

| ID | P | Area | Task | Evidence / risk |
| --- | --- | --- | --- | --- |
| G6 | P1 | go | Move the `assets` HTTP router into `transport/` while keeping its raw-image contract | Quotes moved to `transport/quotesapi`; `infra/assets/handler.go:84` still owns routing and its own writer |
| G5 | P2 | go | Shared HTTP client/retry factory | 10 `&http.Client{...}` sites; retries only in PRTS |
| G10 | P2 | go | One bootstrap for desktop and headless mounts | `go/main.go:277-289` vs `cmd/server/main.go:40-50` |
| C5 | P1 | client | Derive page `isRunning` from the global run projection; keep local state only for submit-in-flight | four local flags; `statusStore.runStatus` + `runStore` already project runs; behavior-sensitive |
| C7 | P2 | client | Split `services/api.ts` into `api/client.ts` + endpoint modules; unify `maaApi` and standalone exports | 1,305 lines, 89 calls, 37 standalone functions |
| C10 | P2 | client | Move page skeletons out of `common/Loading.tsx` next to their pages; remove the test-only DOM branches in `fields.tsx` | Barrel now exports the used primitives; `Loading.tsx` still holds 20 skeletons and `fields.tsx:64,172` branches on `import.meta.env.MODE` |
| C11 | P2 | client | Extract pure helpers from giant pages | `AutomationTasks.tsx:29-150,283,1745-1785`; `Dashboard.tsx:146-300,348-378` |
| C8 | P2 | client | Token/color migration for the remaining literals; shift `statusMessage` pulse RGB to the effective iOS theme | Nine files remain in the `themeColorBoundary` allowlist; ~8 production hex sites; visual verification required |
| C9 | P3 | client | Move page-prefixed CSS out of `index.css` into route CSS | 13 class names defined twice; visual verification required |
| T5 | P3 | toolchain | Shared base-path normalization fixtures consumed by Go and Vite tests | duplicated normalization in `config.go:88-103` and `vite.config.ts:14-20` |
| T6 | P3 | client | Reconcile DESIGN references to `GlassNav`/`GlassMenu` with the actual Layout composition | `DESIGN.md:89,700-712`; decide implement vs doc, needs design call |

## Blocked / pending decision

| ID | Decision | Why blocked |
| --- | --- | --- |
| PD1 | Add client verify/gofmt/race jobs to `.github/workflows` | `AGENTS.md` forbids workflow edits without an explicit request; record and wait |
| PD2 | Implement the primitive/semantic/component token layers from `DESIGN.md` | Visual system change; needs rendered light/dark/mobile verification |
| PD3 | Make the global run projection the only owner of page run state | Changes polling and keep-alive semantics; needs product confirmation |
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
- Quotes HTTP handler moved from `app/quotes` to `transport/quotesapi`; raw JSON contract preserved.
- `MAA_CLI_PATH` resolved once by `config.Config.MAAExecutable`; services no longer read it.
- Task tuning (battle OCR, mastery tick, drop TTL/TZ, WebP, scrcpy, device id) resolved by `config.Tuning`; services receive options.
- Environment reads confined to the config layer: TURN, ADB defaults, Docker detection, and client type resolved by `config.Tuning`; archguard enforces it.
- operbox/depot document shapes moved to `internal/domain/snapshot` with JSON tests; recognition aliases them.
- Common component barrel completed; all primitive deep imports migrated.
- G7: `agentrun.Scope` is the single run-lifecycle writer; transport, MAA, resume, and cron flows delegate to it; lifecycle methods are unexported and guarded (Round 31).
- G1a: `jsval` owns the JSON-null/finite contracts; `drops`, `notifications`, and `infra/maa/results` local coercion copies deleted (Round 32).
- G1b: `gamedata`, `recognition`, and `customtools` local coercion copies deleted; `jsval` gained `Numeric`, `TextOK`, and `FiniteNumberOrNull` (Round 33).
- G1b: `training` migrated to `jsval.FiniteNumber`/`Numeric`/`Truthy`/`StringOrNullish`; only the settings-map adapters remain (Round 34).
- G3: operbox/depot readers decode through `domain/snapshot` (`DecodeOperBox`/`DecodeDepot`); training, mastery, and the `/data` endpoints share the schema. Activity's legacy own-flag heuristic still reads the raw document (Round 35).
