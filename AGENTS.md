# La Pluma Agent Guide

This file contains durable repository guidance for coding agents. Keep it concise and update it when project conventions or verification commands change.

## Project Context

La Pluma is a local web console for Arknights automation. The frontend configures, schedules, and visualizes work; the backend integrates with `maa` CLI, ADB, ScrcpyOverWebRTC, notifications, and local JSON configuration.

- `client/`: React, TypeScript, Vite, Tailwind CSS, Framer Motion, and Zustand.
- `server/`: Node.js ESM, Express routes, service modules, schedulers, and external-process integration.
- `server/routes/agent.js`: primary `/api/agent` route surface.
- `server/routes/agentContract.js`: shared Agent API manifest/OpenAPI registry.
- `client/src/services/api.ts`: frontend API access layer.
- `client/src/components/common/`: shared UI primitives.
- `client/src/index.css`: semantic design tokens and utility classes.

Read these before broad work:

- `README.md` for architecture, setup, Agent API behavior, and deployment.
- `DESIGN.md` for the authoritative visual and component rules.
- `client/src/components/common/README.md` for component props and usage examples only; the visual rules live in the guide.
- `server/README.md` for the server-side helpers and data scripts.

## Working Rules

- Use Node.js `22.12+`; this matches the current Vite/Vitest toolchain and CI expectations.
- Inspect the related source, tests, and `git status` before editing.
- Keep changes focused on the requested behavior. Do not reformat or refactor unrelated code.
- Preserve user changes in a dirty worktree and work with overlapping edits.
- Follow the style already used by the file: strict TypeScript and path aliases in the client; ESM and semicolons in the server.
- Prefer existing components, services, helpers, and semantic abstractions over new parallel implementations.
- Use structured parsers and JSON helpers instead of ad hoc string manipulation.
- Do not treat README claims or external MAA data as proof of runtime behavior; verify the current implementation and data source.

## Frontend And Design

`DESIGN.md` is the authoritative visual and component spec, and `client/src/components/common/README.md` documents component props. Both are committed. When a rule changes, edit those files instead of restating the rule here, so there is exactly one copy of each rule.

Non-negotiables:

- Prefer the components exported from `@/components/common` and the existing semantic `app-*` classes over new parallel implementations. Do not reference or import components and packages the repository does not contain; verify the export exists before citing it.
- Continuous-corner surfaces use the existing `SmoothPanel` / `Card smoothCorners` primitives (with `SmoothSurface` underneath). Keep clipping, corners, and motion inside those components instead of hand-building a second material layer.
- Brand color plus semantic status colors only. No page-specific palettes, bright gradients, colored glow shadows, or decorative color noise.
- Read control sizes, radii, and spacing from the tokens in `client/src/index.css` and `client/src/ios-theme.css`; the iOS shell overrides several base values. Cite the token rather than a number, and never shrink standard controls at call sites.
- Do not nest cards for ordinary page sections. Use headers, dividers, grids, or transparent internal groups.
- Static cards must not gain hover translation, flashing shadow, or transient blur.
- Every interactive control needs `focus-visible`, disabled, and loading behavior. Motion must respect reduced-motion preferences.
- Verify changed UI at desktop and mobile widths in both light and dark themes, across initial, loading, empty, error, disabled, and long-content states. Check contrast from the rendered page in each theme; a single-theme check misses failures.
- User-facing Chinese copy should describe purpose, state, or outcome. Do not expose internal implementation details, fallback mechanisms, or developer terminology as subtitles.

## Backend And Agent API

- Add new backend capabilities to `/api/agent` unless there is a clear ownership reason not to.
- Keep route handlers thin. Put reusable business and integration logic in `server/services`.
- Use `server/utils/apiHelper.js` so responses preserve the standard `success`, `message`, `data` or structured `error`, and `meta` envelope.
- Agent errors need stable codes, useful details, an accurate HTTP status, and a truthful `retryable` value.
- Public Agent API changes must update `server/routes/agentContract.js` and the corresponding contract, route, and service tests. Manifest and OpenAPI must continue to derive from the same registry.
- Long-running or consequential Agent actions must use the tracked Run lifecycle. Preserve `runId`, polling and stop links, idempotency, the shared MAA execution lease, and stable terminal outcomes.
- An accepted Run and its idempotency record must be durably persisted before the external side effect starts. Persistence failure must fail closed instead of starting MAA.
- Restored active Runs become non-retryable `interrupted`; they are not silently resumed. Preserve the current single-process storage limitation unless the storage design is intentionally replaced.
- Never run multiple server instances against the same Agent Run JSON store. Persistence tests and smoke tests must isolate storage under `/tmp` with `LA_PLUMA_AGENT_RUN_STORE`.
- Do not bypass the shared MAA process lifecycle, stop escalation, readiness checks, or cleanup paths. Concurrent starts and start/stop races require deterministic tests.
- Prefer `fileHelper` for JSON file operations and `createLogger` for structured service logs. Do not add routine `console.log` calls in services.

## External Integrations And Side Effects

- Connection logic must support saved profiles and explicit overrides. Do not assume users have a system-wide `adb`; Windows users often rely on emulator-bundled ADB executables.
- Do not hardcode current event names, navigation labels, or one event's stage prefix as universal behavior. Use available metadata, preflight checks, OCR/navigation evidence, and explicit unsupported states.
- MAA, ADB, activity copilots, notifications, schedulers, updates, and device control can affect a real account or device. Tests should use mocks, dry-run, or read-only preflight by default.
- Do not start real combat, consume sanity/medicine/originium, send notifications, update MAA Core/CLI/resources, delete configuration, or run network data-generation scripts unless the user explicitly requests that side effect.
- WebRTC startup must retain serialized readiness, authenticated device matching, timeout cleanup, and stop behavior. Do not leave child processes, ports, or timers running after tests.

## Data And Secrets

- `server/data/`, `server/debug/`, `.env*`, logs, screenshots, and local Docker data are runtime or user-owned data. Do not commit, overwrite, or expose them.
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

Install and run from the repository root:

```bash
npm ci
npm ci --prefix client
npm ci --prefix server

# Run in separate terminals for reliable process cleanup.
npm run dev:server   # http://localhost:3000
npm run dev:client   # http://localhost:5173, proxies /api to port 3000
```

Use the narrowest relevant checks while iterating:

```bash
npm run lint --prefix client
npm run type-check --prefix client
npm run test --prefix client
npm run build --prefix client

npm run check --prefix server
npm run test --prefix server
```

Run the complete repository verification before handing off broad, shared, or release-facing changes:

```bash
npm run verify
```

For a focused server test, run Node's test runner from `server/`, for example:

```bash
cd server
node --test services/__tests__/webrtcService.test.js
```

## Definition Of Done

- The requested behavior works without unrelated regressions or visual drift.
- Tests scale with risk: focused tests for narrow fixes, broader verification for shared services, API contracts, scheduling, persistence, or common UI components.
- UI changes are visually checked rather than accepted from compilation alone.
- Public behavior, setup, API contracts, or design-system changes update the relevant documentation in the same change.
- Final handoff states what changed, what was verified, and any remaining environment limitation.
