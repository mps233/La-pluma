# La Pluma Go backend

This module is the Go rewrite of `server/`. It builds as two entry points:

- `cmd/server`: headless HTTP service for Docker/NAS/PWA.
- `.` / `MyGo` (`main.go`): desktop app (form 2/3) with the backend in-process.

The React client in `../client` is served unchanged. The Node implementation in
`../server` remains the behavioral oracle during migration.

## Status

- Agent API: all 105 Node route paths registered; contract has 46 operations
  (40 advertised), manifest/OpenAPI generated from one Go registry.
- Device preview/control: Pion WebRTC + scrcpy protocol. ScrcpyOverWebRTC is
  not used by this backend.
- MAA: start-game, dynamic run-task, scheduler task flows, fight, activity
  copilot, depot/OperBox recognition, operator mastery, MAA update actions.
- Data: config/profile storage, training, copilot, activity, drops, assets,
  quotes, notifications/Telegram, debug logs, generated game data tools.
- Desktop: `mygo build` produces a signed `.app`/`.dmg`; tray, single-instance,
  loopback server, native bindings, PWA gating and file logging.

## Run

```bash
# from the repository root (so default paths resolve)
cd go
go run ./cmd/server

# or with explicit roots
LA_PLUMA_HOST=127.0.0.1 \
LA_PLUMA_DATA_DIR=/tmp/la-pluma-data \
LA_PLUMA_CLIENT_DIST=../client/dist \
go run ./cmd/server
```

Open `http://localhost:3000`. Set `LA_PLUMA_TOKEN` to require the existing
bearer/`X-La-Pluma-Token` auth contract.

Desktop development:

```bash
cd go
go run .                    # MyGo window loads the in-process loopback server
mygo build -skip-dmg        # or: go run github.com/egoist/mygo/cmd/mygo@v0.8.3 build
```

The desktop build embeds `web/dist` (built by `scripts/build-web.sh`) and copies
`resources/` (including the pinned `scrcpy-server`). Static seed data under
`resources/seed` is copied into the user data directory on first run.

## Data tools

```bash
go run ./cmd/tools seed       # stages, paradox, operator materials, mastery
go run ./cmd/tools materials  # material table + formulas
```

The desktop/`mygo build` script runs `seed` when no seed snapshot is present.
`server/data` is user data and is never committed.

## Docker

```bash
docker build -f go/Dockerfile -t la-pluma-go .
docker run --rm -p 3055:3000 \
  -v "$PWD/la-pluma-data:/app/server/data" \
  -v "$HOME/.config/maa:/root/.config/maa" \
  la-pluma-go
```

The image installs MAA CLI/ADB, runs `maa install --force` if MaaCore is missing,
and serves the React PWA from the same Go process.

## Verify

```bash
go test ./...
go vet ./...
npm run type-check --prefix ../client
npm run build --prefix ../client
```

Real-device smoke tests were run against MuMu (`127.0.0.1:16384`) for Pion
video/touch/key, MAA startup from a closed game, one fight, activity copilot,
depot/OperBox recognition, and mastery scheduling. See
`docs/go-rewrite/PLAN.md` for the remaining gaps and test notes.

## Migration plan

See `docs/go-rewrite/PLAN.md`. The Node server must not run against the same
data root or MAA lease file as the Go server; concurrent MAA runs from another
install are not coordinated by this process.