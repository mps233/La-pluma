# Governance Task Pool

Status: `todo`, `doing`, `blocked`, `done`. Priority reflects value ÷ risk;
a lower-priority item may still be blocked on a decision. Every task names the
evidence and the canonical target so it can be picked up by a parallel agent
without re-investigation.

## Next up

| ID | P | Area | Task | Evidence |
| --- | --- | --- | --- | --- |

## Performance

| ID | P | Area | Task | Evidence |
| --- | --- | --- | --- | --- |
| PF5 | P3 | Agent API | Drop the unused `recentLogs` field from `/runs/current` and `/status`, or make it opt-in. | The client requests `?lines=1` and never reads the field; other callers can receive up to 80 lines of up to 4000 chars. |
| PF6 | P3 | Client CSS | Prune the remaining global handwritten CSS after the route split. | Entry CSS is 259 KB raw / 40.8 KB gzip. |

## Larger refactors

| ID | P | Area | Task | Evidence / risk |
| --- | --- | --- | --- | --- |

## Blocked / pending decision

| ID | Decision | Why blocked |
| --- | --- | --- |
| PF3 | How to move the WebRTC preview out of the entry without losing the shared connection | The App-level `PreviewSessionProvider` owns the only WebRTC session and restarts it on quality changes. A lazy preview entry either duplicates that session or needs a session-engine split; measured entry cost is ~24 KB generated. |

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
- C7d: training endpoints and their types moved to `services/api/training.ts` and re-exported (Round 50).
- C7e: `maaApi` and its DTOs moved to `services/api/maa.ts`; `services/api.ts` is a 63-line facade (Round 51).
- C7f: shared API DTOs moved to `services/api/types.ts`; `maa.ts` imports them and the facade re-exports them (Round 52).
- C7g: all remaining `maaApi` groups moved to `services/api/groups/*`; `maa.ts` composes them (Round 54). C7 is complete.
- C8: all JS hex/RGB literals migrated to theme tokens (including status pulse RGB per theme); CustomTools' user palette is a documented user-content exception (ADR-0005, Round 55).
- G13: terminal persistence failures now fail the request instead of being discarded (`Execute`/`Settle`/accepted-stop release), with tests (Round 56).
- C10c: the jsdom-only native branches are gone from `fields.tsx`; a vitest setup harness renders accessible native Glass Select/Checkbox controls (Round 58).
- T5: `testdata/base-path-fixtures.json` is consumed by both the Go config test and the Vite config test (Round 57).
- PD5: PRTS retries use the canonical 500 ms × attempt cadence for activity and copilot (ADR-0003, Round 60).
- PD3: page run state stays a projection/local hybrid; C5b is rejected (ADR-0004, Round 60).
- PD6/PD7/PD8: CustomTools palette is user content; GlassNav/GlassMenu are documented adapters; page base CSS stays global and C9 is rejected (ADR-0005/0006/0007, Round 60).
- PD1: `go-verify.yml` now runs gofmt, lifecycle race tests, and the client verify suite with `contents: read` only (Round 61).
- PD2: primitive/semantic/component token layers completed for both theme files, with a boundary test that rejects colour literals outside primitive definitions (ADR-0008/0009/0010, Rounds 61–63).
- PF0: framer-motion left the entry preload. The onboarding guide and access-token dialog are lazy, Modal/StatusMark are direct imports instead of barrel exports, and framer-motion is no longer a named manual chunk. Initial JS fell by ~49 KB gzip and the PWA precache by ~140 KiB (Round 64).
- PF1a: the preview auto-start glass switch mounts only after preview is enabled; the default dashboard no longer requests the three.js `runtime` chunk (Round 65).
- PF1b: the glass renderer is interaction-gated. Switch and CheckboxField paint solid fallbacks; the first interaction loads three.js once and upgrades every mounted canvas. Automation, Config, Combat, and the other control pages no longer request the runtime on load (Round 66).
- PF2: the Dynamic Island provider, surface, four activity adapters, islandcn visuals, and hugeicons now live behind one lazy `IslandLayer` chunk mounted after the first frame. The entry fell by ~196 KB raw / ~70 KB gzip; the PWA precache fell from 1,240 KiB to 1,048 KiB (Round 67).
- PF4b: `GlassButtonGroup` now imports the lightweight popup context/anchor; the heavy popup surface stays behind menus/selects. The preloaded popup chunk fell from 12.4 to 2.3 KB gzip, and total initial JS+CSS from ~244 to ~235 KB gzip (Round 69).
- PF4: the glass menu is behind a lazy `GlassMenu` boundary, the common barrel no longer exports the glass form fields, and glass/common modules are marked side-effect-free. Initial preloaded JS+CSS fell from ~286 KB to ~244 KB gzip; the PWA precache fell to 729 KiB; the menu chunk loads on interaction (Round 68).
