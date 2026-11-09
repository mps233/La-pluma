# La Pluma Agent Guide

This file contains durable repository guidance for coding agents. Keep it concise and update it when project conventions or verification commands change.

## Project Context

La Pluma is a local web console for Arknights automation. The frontend configures, schedules, and visualizes work; the Go backend integrates with the `maa` CLI, ADB, scrcpy/WebRTC, notifications, and local JSON configuration. A MyGo desktop shell embeds the same client and backend.

- `client/`: React, TypeScript, Vite, Tailwind CSS, Framer Motion, and Zustand.
- `go/`: Go backend and MyGo desktop shell.
- `go/internal/transport/agentapi/handler.go`: primary `/api/agent` route surface.
- `go/internal/contract/operations.go`: shared Agent API manifest/OpenAPI registry.
- `go/internal/app/`: MAA, scheduler, Agent runs, WebRTC, training, notifications, and domain services.
- `go/internal/infra/`: ADB, MAA, scrcpy, and Pion WebRTC adapters.
- `client/src/services/api.ts`: frontend API access layer.
- `client/src/components/common/`: shared UI primitives.
- `client/src/index.css`: semantic design tokens and utility classes.

Read these before broad work:

- `README.md` for architecture, setup, Agent API behavior, and deployment.
- `DESIGN.md` for the authoritative visual and component rules.
- `client/src/components/common/README.md` for component props and usage examples only; the visual rules live in the guide.
- `go/README.md` and `go/docs/go-rewrite/PLAN.md` for backend setup, status, and known gaps.

## Working Rules

- Use Go `1.27+` for the backend. Use Node.js `22.12+` only for the client build and tests.
- Run `gofmt` on changed Go files. Keep Go packages small and follow the existing `internal/` layering.
- Inspect the related source, tests, and `git status` before editing.
- Keep changes focused on the requested behavior. Do not reformat or refactor unrelated code.
- Preserve user changes in a dirty worktree and work with overlapping edits.
- Follow the style already used by the file: strict TypeScript and path aliases in the client; idiomatic Go with explicit error codes in the backend.
- Prefer existing components, services, helpers, and semantic abstractions over new parallel implementations.
- Use structured parsers and JSON helpers instead of ad hoc string manipulation.
- Do not treat README claims or external MAA data as proof of runtime behavior; verify the current implementation and data source.

## Frontend And Design

`DESIGN.md` is the authoritative visual and component spec, and `client/src/components/common/README.md` documents component props. Both are committed. When a rule changes, edit those files; the list below is only a short pointer for agents that have not read the spec yet, not a second copy of the rules. Tooling that generates its own `DESIGN.md` (design linters, prompt packs, `/impeccable document`) must merge into this file or write elsewhere; never let it overwrite the committed spec.

Non-negotiables (these are pointers; `DESIGN.md` is authoritative if the summary and the spec differ):

- Read `DESIGN.md` and `client/src/components/common/README.md` before UI work; use the components exported from `@/components/common` and the existing semantic `app-*` classes. Do not build parallel implementations or import things the repository does not export.
- Declare the page archetype before layout and follow its reference implementation; do not force log/device/settings pages into the default Card skeleton.
- Cover the component state matrix and the content-design templates; do not invent per-page labels, errors, empty states, or number formats.
- Brand color plus semantic status colors only; game-resource rarity colors are the documented exception. No page-specific palettes, bright gradients, colored glow shadows, or decorative color noise.
- Read control sizes, radii, and spacing from the tokens in `client/src/index.css` and `client/src/ios-theme.css`; cite the token rather than a number, and never shrink standard controls at call sites.
- Do not nest cards for ordinary page sections. Use headers, dividers, grids, or transparent internal groups.
- Static cards must not gain hover translation, flashing shadow, or transient blur; only genuinely clickable cards use the documented hover treatment.
- Every interactive control needs `focus-visible`, disabled, and loading behavior. Motion must respect reduced-motion preferences.
- Verify changed UI at desktop and mobile widths in both light and dark themes, across initial, loading, empty, error, disabled, and long-content states. Check contrast from the rendered page in each theme; a single-theme check misses failures.
- User-facing Chinese copy should describe purpose, state, or outcome. Do not expose internal implementation details, fallback mechanisms, or developer terminology as subtitles.

## Backend And Agent API

- Add new backend capabilities to `/api/agent` unless there is a clear ownership reason not to.
- Keep handlers thin. Put reusable business and integration logic in `go/internal/app/`.
- Use the error helpers in `go/internal/util/errors` so responses preserve the standard `success`, `message`, `data` or structured `error`, and `meta` envelope.
- Agent errors need stable codes, useful details, an accurate HTTP status, and a truthful `retryable` value.
- Public Agent API changes must update `go/internal/contract/operations.go` and the corresponding contract, route, and service tests. Manifest and OpenAPI must continue to derive from the same registry.
- Long-running or consequential Agent actions must use the tracked Run lifecycle. Preserve `runId`, polling and stop links, idempotency, the shared MAA execution lease, and stable terminal outcomes.
- An accepted Run and its idempotency record must be durably persisted before the external side effect starts. Persistence failure must fail closed instead of starting MAA.
- Restored active Runs become non-retryable `interrupted`; they are not silently resumed. Preserve the current single-process storage limitation unless the storage design is intentionally replaced.
- The data directory is guarded by a cross-process lock; a second instance must fail with `LA_PLUMA_INSTANCE_LOCKED`. Do not remove that guard without replacing the single-writer storage design.
- Do not bypass the shared MAA process lifecycle, stop escalation, readiness checks, or cleanup paths. Concurrent starts and start/stop races require deterministic tests.
- Prefer `jsonstore` for JSON file operations and the service logger for structured logs. Do not add routine `fmt.Println` calls in services.

## External Integrations And Side Effects

- Connection logic must support saved profiles and explicit overrides. Do not assume users have a system-wide `adb`; Windows users often rely on emulator-bundled ADB executables.
- Do not hardcode current event names, navigation labels, or one event's stage prefix as universal behavior. Use available metadata, preflight checks, OCR/navigation evidence, and explicit unsupported states.
- MAA, ADB, activity copilots, notifications, schedulers, updates, and device control can affect a real account or device. Tests should use mocks, dry-run, or read-only preflight by default.
- Do not start real combat, consume sanity/medicine/originium, send notifications, update MAA Core/CLI/resources, delete configuration, or run network data-generation scripts unless the user explicitly requests that side effect.
- WebRTC startup must retain serialized readiness, authenticated device matching, timeout cleanup, and stop behavior. Do not leave child processes, ports, or timers running after tests.
- The preview must tolerate maa-cli's automatic resource update failing on the network; keep the retry/error classification in the scheduler covered by tests.

## Data And Secrets

- The runtime data directory (`LA_PLUMA_DATA_DIR`, desktop user data), `go/build/`, `go/web/dist/`, `.env*`, logs, screenshots, and local Docker data are runtime or user-owned data. Do not commit, overwrite, or expose them.
- Never print or commit tokens, cookies, Telegram chat IDs, device secrets, or authorization headers.
- Generated game-data updates must record their source and be reviewed as data changes, not hidden inside unrelated feature work.

## Git And Supply Chain Safety

- Do not commit or push unless the user explicitly asks.
- When asked to commit, inspect the exact staged scope and use a concise conventional commit message such as `feat:`, `fix:`, `refactor:`, `test:`, or `docs:`.
- Never use destructive Git commands or discard unrelated user changes.
- A push to `main` triggers the Docker workflow and publishes `latest`; a `v*` tag publishes version images. Never push or create a release tag as an incidental verification step.
- Treat `.github/workflows/docker-publish.yml` and all workflow edits as high-risk supply-chain changes. This repository previously had a malicious mining modification.
- Do not modify `.github/` unless the user explicitly requests it. If a workflow change is required, review permissions, third-party actions, downloads, shell commands, secrets, and triggers line by line, and show the workflow diff separately before commit or push.

## Commands

Install client dependencies and run the backend:

```bash
npm ci --prefix client

# Terminal 1: Go backend on http://localhost:3000
cd go && go run ./cmd/server

# Terminal 2: Vite client on http://localhost:5173
npm run dev:client
```

Use the narrowest relevant checks while iterating:

```bash
npm run lint --prefix client
npm run type-check --prefix client
npm run test --prefix client
npm run build --prefix client

cd go && go test ./...
cd go && go vet ./...
```

Run the complete repository verification before handing off broad, shared, or release-facing changes:

```bash
npm run verify
cd go && go test ./... && go vet ./...
```

For a focused Go test, run it from `go/`, for example:

```bash
cd go
go test ./internal/app/scheduler -run TestRecruitRetriesTransientMAAUpdateFailure -count=1
```

## Definition Of Done

- The requested behavior works without unrelated regressions or visual drift.
- Tests scale with risk: focused tests for narrow fixes, broader verification for shared services, API contracts, scheduling, persistence, or common UI components.
- UI changes are visually checked rather than accepted from compilation alone.
- Public behavior, setup, API contracts, or design-system changes update the relevant documentation in the same change.
- Final handoff states what changed, what was verified, and any remaining environment limitation.
