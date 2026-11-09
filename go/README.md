# La Pluma Go backend

This module is the Go backend and desktop shell. It builds as two entry points:

- `cmd/server`: headless HTTP service for Docker/NAS/PWA.
- `.` / `MyGo` (`main.go`): desktop app (form 2/3) with the backend in-process.

The React client in `../client` is served unchanged. The former Node backend was
archived and removed after parity was proven; its golden contract fixtures remain
under `internal/contract/testdata`.

## Status

- Agent API: all 105 legacy route paths registered; contract has 46 operations
  (40 advertised), manifest/OpenAPI generated from one Go registry.
- Device preview/control: Pion WebRTC + scrcpy protocol, including touch, scroll,
  key/text and clipboard; an embedded Pion TURN/STUN server is advertised over
  signaling. The external preview service is not used by this backend.
- MAA: start-game, dynamic run-task, scheduler task flows, fight, activity
  copilot, depot/OperBox recognition, operator mastery, MAA update actions.
- Data: config/profile storage, training, copilot, activity, drops, assets,
  quotes, notifications/Telegram, debug logs, generated game data tools. The
  data directory is guarded by a cross-process lock (`la-pluma.instance.lock`);
  a second instance fails with `LA_PLUMA_INSTANCE_LOCKED` instead of racing on
  the single-process Agent run store.
- Desktop: `mygo build` produces an ad-hoc signed `.app` (DMG optional); tray, single-instance,
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
The default data directory is `server/data` relative to the working directory; it is user data and is never committed.

## Docker

```bash
docker build -f go/Dockerfile -t la-pluma-go .
docker run --rm -p 3055:3000 -p 3478:3478/udp \
  -e LA_PLUMA_WEBRTC_TURN_PUBLIC_IP=<host-lan-ip> \
  -v "$PWD/la-pluma-data:/app/data" \
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

## Known gaps

- Developer ID signing/notarization and an app updater are not configured.
- Embedded TURN uses UDP 3478 and needs `LA_PLUMA_WEBRTC_TURN_PUBLIC_IP` plus a published port behind Docker/NAT. If 3478 is occupied, set `LA_PLUMA_WEBRTC_TURN_PORT`.
- Phone PWA install, multi-touch, battle OCR, Windows/Linux runtime and broader destructive flows still need verification.

## Migration plan

See `docs/go-rewrite/PLAN.md`. The Go server takes
`<data-dir>/la-pluma.instance.lock` for its lifetime, so two Go instances can
never write the same Agent run store or MAA lease. MAA runs from a different
install with a different data root are not coordinated.