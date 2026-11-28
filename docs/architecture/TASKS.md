# Governance Task Pool

Status: `todo`, `doing`, `blocked`, `done`. Priority reflects value ÷ risk;
a lower-priority item may still be blocked on a decision. Every task names the
evidence and the canonical target so it can be picked up by a parallel agent
without re-investigation.

## Next up

| ID | P | Area | Task | Evidence |
| --- | --- | --- | --- | --- |
| G13 | P3 | go | Surface persistence errors discarded by stop/settle paths | `agentrun.Scope.Stop` ignores `releaseIdempotency` errors and `Settle` ignores `fail` errors, matching the pre-scope transport; decide whether a failed terminal write must fail the request |

## Larger refactors

| ID | P | Area | Task | Evidence / risk |
| --- | --- | --- | --- | --- |
| C7d | P2 | client | Split the training endpoints and the `maaApi` object out of `services/api.ts` | Notifications moved to `services/api/notifications.ts`; `api.ts` still holds the training functions/types and the maaApi surface |
| C10c | P3 | client | Remove the jsdom-only DOM branches in `fields.tsx` | `SelectField`/`CheckboxField` render native controls when `import.meta.env.MODE === 'test'`; tests must drive the glass controls or a shared a11y harness instead. The page skeletons are already page-adjacent (C10b) |
| C8 | P2 | client | Token/color migration for the remaining literals; shift `statusMessage` pulse RGB to the effective iOS theme | Nine files remain in the `themeColorBoundary` allowlist; ~8 production hex sites; visual verification required |
| C9 | P3 | client | Move page-prefixed CSS out of `index.css` into route CSS | 13 class names defined twice; visual verification required |
| T5 | P3 | toolchain | Shared base-path normalization fixtures consumed by Go and Vite tests | duplicated normalization in `config.go:88-103` and `vite.config.ts:14-20` |
| T6 | P3 | client | Reconcile DESIGN references to `GlassNav`/`GlassMenu` with the actual Layout composition | `DESIGN.md:89,700-712`; decide implement vs doc, needs design call |

## Blocked / pending decision

| ID | Decision | Why blocked |
| --- | --- | --- |
| PD1 | Add client verify/gofmt/race jobs to `.github/workflows` | `AGENTS.md` forbids workflow edits without an explicit request; record and wait |
| PD2 | Implement the primitive/semantic/component token layers from `DESIGN.md` | Visual system change; needs rendered light/dark/mobile verification |
| PD3 | Make the global run projection the only owner of page run state (includes C5b: migrate `AutomationTasks`/`DataStatistics` and retire the restore monitor's running writer) | Changes polling and keep-alive semantics; needs product confirmation |
| PD5 | Choose one PRTS retry contract (activity starts at attempt 0, copilot at 1) | Transport is now shared in `internal/infra/prts`; activity keeps 250 ms × attempt and copilot 500 ms × attempt. Pick the canonical schedule before changing either. |

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
- G2: one PRTS transport in `internal/infra/prts`; activity and copilot keep their own retry policies and envelope parsing (Round 36).
- G6: the assets router and raw image writers moved to `transport/assetsapi`; `infra/assets` is a resolver + WebP cache, and the archguard now forbids HTTP handlers in app and infra (Round 37).
- C5a: `selectOwnedRun` + `useOwnedRunActive` derive the page run from the global projection; Combat and Roguelike combine it with a submit-in-flight flag (Round 38).
- G1c: `jsval` now owns the last coercion copies; `mastery`, `scheduler`, `updates`, `run_resume`, `agentapi`, and `quotes` keep only documented field/domain adapters (Round 39).
- G5: `internal/infra/httpclient` owns client construction; nine ad-hoc `&http.Client` sites migrated and guarded (Round 40).
- G10: `transport/bootstrap.ServerOptions` is the shared mount for desktop and headless entries; an archguard checks both use it (Round 41).
- G12: agentapi route tests now cover ~45 of 107 routes, including config/profile CRUD, notification config, logs, drops, training, schedules, and snapshot data (Round 42).
- C10a: shared `Skeleton`/`PageHeaderSkeleton` primitives and `DashboardSkeleton` moved next to their consumers; `Loading.tsx` shrank by the dashboard block (Round 43).
- C10b: every page skeleton moved next to its page; `common/Loading.tsx` is only the spinner and `components/PageSkeleton.tsx` dispatches variants (Round 44).
- C11a: AutomationTasks schedule-time parsing/normalization moved to `utils/automationSchedule.ts` with tests (Round 45).
- C11b: Dashboard payload guards/completion normalization/usage classes moved to `utils/dashboardData.ts` with tests (Round 46).
- C7a: HTTP base URL/fetch/auth moved to `services/api/client.ts`; `api.ts` re-exports it and the boundary test allows the new module (Round 47).
- C7b: mastery, skland, copilot-search, and drops endpoints moved to `services/api/*` and re-exported from `api.ts` (Round 48).
- C7c: notification config types, cache, and `notificationsApi` moved to `services/api/notifications.ts` and re-exported (Round 49).
