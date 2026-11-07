# La Pluma Go backend

This module is the Go rewrite of `server/`. It is built as two entry points:

- `cmd/server`: headless HTTP service for Docker/NAS/PWA.
- `cmd/desktop`: MyGo desktop app (form 2/3) with the same backend in-process.

The React client in `../client` is served unchanged. The Node implementation in
`../server` remains the behavioral oracle during migration.

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

## Verify

```bash
go test ./...
go vet ./...
```

## Migration plan

See `docs/go-rewrite/PLAN.md`. The Node server must not run against the same
data root or MAA lease file as the Go server.