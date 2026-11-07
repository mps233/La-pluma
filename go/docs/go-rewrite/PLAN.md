# La Pluma Go rewrite plan

Branch: `feat/go-backend`
Goal: replace the Node backend with a pure-Go backend, ship a MyGo desktop app
(form 2/3: React/WebView UI + Go-native shell), replace ScrcpyOverWebRTC with a
Pion WebRTC + scrcpy-protocol implementation, and verify on the real MuMu
emulator.

## Hard constraints

- Preserve the existing HTTP/JSON contract while the React client is shared.
- Keep `server/` (Node) as the migration oracle until parity is proven. Never
  run two writers against the same data root or MAA lease file.
- Do not modify or commit unrelated dirty worktree files.
- No real combat / sanity / medicine consumption without explicit confirmation.
  Read-only device checks (devices, screenshots, UI state) are allowed.
- MyGo is pure Go, no cgo. Do not add cgo dependencies.
- Use a single execution owner/actor for MAA lease admission.

## Target layout

```text
go/
├─ cmd/desktop/          MyGo desktop entry
├─ cmd/server/           headless Docker/NAS/PWA entry
├─ internal/app/         use cases
├─ internal/domain/      pure types/rules
├─ internal/infra/       ADB/MAA/scrcpy/store/OCR adapters
├─ internal/transport/   HTTP/agent/signaling
├─ internal/contract/    Agent API registry + OpenAPI/manifest
├─ internal/desktop/     MyGo-only shell/native/tray/updater
├─ internal/webassets/   embedded client dist
└─ resources/            MyGo resources
```

## Phases

- [x] 0. Branch + Go module + runnable headless HTTP skeleton
  - [x] config/env/paths (including MAA dirs)
  - [x] health, auth, CORS, static SPA fallback, cache headers
  - [x] graceful shutdown, TLS
  - [ ] gzip parity
  - [ ] tests green
- [ ] 1. Data + execution core
  - [ ] atomic JSON store + file locks
  - [ ] agent run FSM/idempotency/restore/flush
  - [ ] MAA execution lease actor
  - [ ] ADB discovery/connection/screenshot
  - [ ] MAA CLI runner/callbacks/dynamic task files
- [ ] 2. Agent API parity
  - [ ] contract registry (32 operations, manifest, OpenAPI)
  - [ ] 97 Agent routes
  - [ ] assets/operator-quotes/health/signaling mounts
  - [ ] golden contract tests against Node oracle
- [ ] 3. Scheduling and task flows
  - [ ] node-cron-equivalent scheduling with timezone/missed-run policy
  - [ ] automation/combat/roguelike/custom task flows
  - [ ] startup restore + stop propagation
- [ ] 4. Device preview/control replacement
  - [ ] scrcpy server push/launch/protocol
  - [ ] H.264 video socket -> Pion WebRTC track
  - [ ] control socket (touch/key/text/scroll/clipboard)
  - [ ] React client transport compatibility or new transport
  - [ ] remove ScrcpyOverWebRTC dependency
- [ ] 5. Domain modules
  - [ ] training/operator materials
  - [ ] copilot/activity
  - [ ] drops/statistics
  - [ ] notifications/Telegram
  - [ ] config/quotes/assets
  - [ ] battle OCR (tesseract CLI or feature flag)
- [ ] 6. MyGo desktop 2/3
  - [ ] desktop shell: window/tray/single-instance/quit
  - [ ] native bindings: file picker/notify/open/autostart/update
  - [ ] tray flyout (native UI)
  - [ ] PWA gating + desktop bridge
  - [ ] signing/notarization/updater
- [ ] 7. Real MuMu verification
  - [ ] device connect/screenshot read-only
  - [ ] live view + touch/key control
  - [ ] MAA task smoke (with explicit approval for side effects)
  - [ ] quit/restart/orphan cleanup
  - [ ] PWA from headless Go server

## Pion + scrcpy design notes (to validate)

- Push a pinned `scrcpy-server.jar` to the device and launch it through
  `adb shell app_process`.
- Parse the video socket: scrcpy sends a 12-byte header (codec id, width,
  height) then H.264 NAL units with 12-byte packet headers. Convert to Pion
  H.264 RTP with proper SPS/PPS, keyframe and timestamp handling.
- Control socket uses scrcpy's binary control protocol. Implement touch
  (down/up/move), multi-pointer, key events, text, scroll, clipboard.
- Audio (optional in v1) uses an Opus stream; do not block video/control on it.
- Do not add cgo. Use Pion v4 and a pure-Go RTP/H264 packetizer.
- The React client currently expects ScrcpyOverWebRTC signaling semantics;
  either preserve the same signaling surface or add a new transport and update
  the client deliberately.

## Open decisions / questions

- MyGo CLI is not installed on this machine yet; install and pin v0.8.3+.
- Real MuMu test: which device is the MuMu instance? `127.0.0.1:16384` (PHU110)
  is the likely target; confirm before driving tasks.
- Real MAA task testing may consume sanity/medicine; needs explicit approval.
- Scrcpy version/protocol pin needs a source review before implementation.