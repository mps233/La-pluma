# Architecture Invariants

Every rule here is checked by an automated command. A rule without an
enforcement mechanism belongs in `TASKS.md`, not in this list.

| Invariant | Enforcement | Command |
| --- | --- | --- |
| Internal dependencies point downward (transport → app → infra/domain → util/config); no app subpackage imports the composition root | `go/internal/archguard/arch_test.go` | `cd go && go test ./internal/archguard` |
| Every new top-level `internal/<layer>` has a declared dependency rule | `TestLayersAreKnown` | `cd go && go test ./internal/archguard` |
| Every operation in the Agent API registry resolves to a registered mux route | `agentapi/route_contract_test.go` | `cd go && go test ./internal/transport/agentapi` |
| Manifest and OpenAPI derive from one registry, stay deterministic, and keep their advertised counts | `internal/contract/contract_test.go` + Node oracle fixtures | `cd go && go test ./internal/contract` |
| The HTTP envelope keeps `success/message/data/error/meta`; unknown errors never leak details | `internal/transport/httpx/httpx_test.go` | `cd go && go test ./internal/transport/httpx` |
| Application errors keep stable codes, status, retryability, and non-nil details | `internal/util/errors/errors_test.go` | `cd go && go test ./internal/util/errors` |
| Run status strings, classification, DTO links, and optional fields stay stable | `internal/domain/agentrun/status_test.go` | `cd go && go test ./internal/domain/agentrun` |
| Atomic file replacement has one implementation (0600 temp file, fsync, rename) | `internal/util/jsonstore/store_test.go` | `cd go && go test ./internal/util/jsonstore` |
| Application code imports Liquid Glass only through `@/components/glass` (documented preview exception) | ESLint `no-restricted-imports` | `npm run lint --prefix client` |
| Environment access stays in the config layer (`internal/config`, `internal/app/config`); entry points may snapshot env into Config | `TestEnvironmentReadsStayInConfig` | `cd go && go test ./internal/archguard` |
| The `internal/app` layer owns no HTTP handlers (`ServeHTTP`/`http.Handler`) | `TestAppLayerHasNoHTTPHandlers` | `cd go && go test ./internal/archguard` |
| Agent API endpoint files stay split by domain (≤ 800 production lines per file) | `TestAgentAPIFilesStaySmall` | `cd go && go test ./internal/archguard` |
| Raw `fetch(` appears only in `services/api.ts`; everything else uses `fetchWithAuth`/`maaApi` | `services/apiBoundary.test.ts` | `npm run test --prefix client` |
| Client lint does not exceed the current warning count | `--max-warnings 1` in `client/package.json` | `npm run lint --prefix client` |
| Strict TypeScript, including `noUnusedLocals` and `noUnusedParameters` | `tsc --noEmit` | `npm run type-check --prefix client` |
| Pages are code-split and PWA/page caching configuration is covered | `vite.config.test.ts` | `npm run test --prefix client` |

## Not yet enforceable

These are known gaps; do not treat them as guaranteed by CI:

- `gofmt`, `-race`, staticcheck, or govulncheck in CI.
- Client lint/type-check/test on non-main branches (only `docker-publish.yml`
  runs the client; `.github/` is intentionally untouched).
- No hard-coded hex colors outside the token files.
- No page CSS selectors duplicated in global CSS.
- No HTTP handlers in `infra` (the assets router remains; `app` is enforced).
