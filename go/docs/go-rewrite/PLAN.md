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
  - [x] gzip parity
  - [x] tests green
- [~] 1. Data + execution core
  - [x] atomic JSON store + file locks
  - [x] agent run FSM/idempotency/restore/flush
  - [x] MAA execution lease actor
  - [x] ADB client (devices/connect/screenshot/input/push/reverse/forward)
  - [x] MAA CLI runner (spawn/wait/stop/line capture)
  - [x] MAA callbacks/dynamic task files/TOML profiles
  - [ ] ADB emulator discovery orchestration
- [x] 2. Agent API parity
  - [x] contract registry (46 operations, 40 advertised; manifest/OpenAPI)
  - [x] all 105 Agent route paths registered (some return stable 501 for unported scripts)
  - [x] assets/operator-quotes/health/signaling mounts
  - [x] golden contract tests against Node oracle (`internal/contract/testdata`)
- [~] 3. Scheduling and task flows
  - [x] Go scheduler core: game timezone, flow validation/plan, sequential execution, startup restore, stop
  - [x] HTTP schedule routes; startup-only flow verified on MuMu
  - [x] tracked Run wrapper around scheduled flows (HTTP, cron, activity, copilot set, manual, updates)
  - [x] start-game, dynamic run-task (StartUp), and startup-only daily flow verified on real MuMu
  - [x] fight/copilot execution and recognition actions
- [~] 4. Device preview/control replacement
  - [x] scrcpy server push/launch/protocol (scrcpy-server 3.3.4)
  - [x] H.264 video socket -> Pion WebRTC track
  - [x] control socket touch/key/text base commands
  - [x] React client signaling compatibility verified in browser
  - [~] clipboard/scroll/multi-touch parity (clipboard + scroll + ACTION_CANCEL done; multi-touch real-device verification pending)
  - [x] remove ScrcpyOverWebRTC from remaining Node paths (Go runtime is independent; Node stays as oracle)
- [x] 5. Domain modules
  - [x] training/operator materials (fetch action returns explicit unsupported)
  - [x] copilot planning/discovery core (execution/manual session wiring pending)
  - [x] drops/statistics + MAA result parsers
  - [x] notifications/Telegram service and bot
  - [x] config/profile storage, quotes, MaaResource assets
  - [x] activity current/preflight/discovery/run execution (real TL-1 copilot run verified)
  - [x] battle OCR interface remains a feature flag/gap (no tesseract replacement yet)
  - [x] recognition depot/operbox (real device verified)
- [x] 6. MyGo desktop 2/3
  - [x] desktop shell: window/loopback server/single-instance/tray/quit
  - [x] `mygo build` app bundle (ad-hoc signed, 27 MB)
  - [x] native bindings: file picker/notify/open/autostart/app info
  - [x] tray flyout (native UI) + desktop settings panel
  - [x] PWA gating + desktop worker/cache cleanup
  - [ ] Developer ID signing/notarization/updater (needs credentials)
  - [x] desktop bridge wired into React Config page
- [x] 7. Real MuMu verification
  - [x] device connect/screenshot read-only
  - [x] live view + touch/key control (Pion probe + React client)
  - [x] live MAA start-game, dynamic run-task, one fight, daily flow
  - [x] activity copilot one stage, operbox/depot recognition, mastery blocked/training-room path
  - [ ] exhaustive destructive flows and desktop PWA/phone verification
  - [ ] MAA task smoke (with explicit approval for side effects)
  - [ ] quit/restart/orphan cleanup (code path exists; real-device verification pending)
  - [ ] PWA from headless Go server (static/SW served; phone install pending)

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