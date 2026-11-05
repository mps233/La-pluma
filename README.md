<p align="center">
  <img src="screenshots/cover.png" alt="La Pluma: logo and the automation workspace in light and dark themes" width="100%">
</p>

<h1 align="center">La Pluma</h1>

<p align="center">A local web console for Arknights automation.</p>

<p align="center"><a href="README.zh.md">中文</a></p>

<p align="center">
  <a href="https://hub.docker.com/r/miaona/la-pluma"><img alt="Docker Pulls" src="https://img.shields.io/docker/pulls/miaona/la-pluma"></a>
  <a href="https://hub.docker.com/r/miaona/la-pluma"><img alt="Docker Image Size" src="https://img.shields.io/docker/image-size/miaona/la-pluma/latest"></a>
  <a href="https://github.com/mps233/La-pluma/actions/workflows/docker-publish.yml"><img alt="Docker Build and Push" src="https://github.com/mps233/La-pluma/actions/workflows/docker-publish.yml/badge.svg"></a>
  <a href="https://nodejs.org/"><img alt="Node.js 22.12+" src="https://img.shields.io/badge/Node.js-22.12%2B-5FA04E"></a>
  <a href="https://react.dev/"><img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB"></a>
  <a href="https://github.com/MaaAssistantArknights/maa-cli"><img alt="MAA CLI" src="https://img.shields.io/badge/MAA-CLI-111111"></a>
</p>

## Overview

La Pluma is a self-hosted web console for Arknights automation. It puts the `maa` CLI, ADB and ScrcpyOverWebRTC behind one interface: compose a daily task flow, run copilot plans and roguelike runs, schedule the routine, and watch the emulator from a browser. Configuration, run history, drop records and operator data stay on the machine that runs the server.

Beyond the UI, `/api/agent` exposes the same capabilities as a semantic manifest and OpenAPI surface, so scripts and AI agents can discover actions, read status, dry-run a plan and follow a run to its terminal state.

The project is named after La Pluma, the five-star Guard in Arknights.

## Features

### Console

- **Today at a glance** — current event with a remaining-time progress bar, today's open and closed resource and chip stages, the current run and last result, training queue, today's drops, and ADB device health (CPU, memory, `/data` disk, battery temperature).
- **One-click routine** — run the saved daily flow from the dashboard, or prepare a matching copilot plan for the current event without starting combat.
- **Optional preview** — keep the preview off, refresh a snapshot every 10 seconds, or open a live WebRTC view. Snapshot mode falls back to ADB screenshots, and the console keeps its last successful data when a refresh fails. Touch control is available in the device preview on the task workspaces.
- **Responsive shell** — desktop sidebar with workspace search, mobile bottom bar with a secondary sheet, light/dark/system themes, and an iOS-style material shell. The PWA can be installed and updated from the UI.

### Daily automation

- **Composable flow** — Start Game, Fight, Infrastructure, Auto Recruit, Credit Store, Awards and Close Game. Reorder by drag or keyboard, enable individual tasks, add another instance from the picker, undo deletions, and let the flow auto-save.
- **Fight planning** — multiple stages with per-stage run counts, pinned stages, smart stages generated from the training queue, sanity medicine and expiring medicine, originium, series `-1` to `10`, drop targets, drop server and report upload.
- **Runtime awareness** — resource stages are skipped on closed days, later stages stop when sanity runs out, current event codes replace `HD-N`, and Annihilation is treated as a skip when its entry is unavailable. Expiring-medicine days, a drop server or series 7–10 switch to a dynamic MAA task, where these per-stage checks no longer apply.
- **Per-task options** — base shift modes with facility and drone settings, recruit star/tag/time rules, credit-store priority and blacklist, seven award categories, and an optional depot scan before closing the game.
- **Scheduling** — up to six daily times per flow, each enabled separately, and restored after a restart. Only one flow runs at a time.
- **Run feedback** — step progress and elapsed time, stop by `runId`, per-task success/failure/skip counts, and expandable drops, reports, errors and warnings. Ordinary task failures continue the flow; a Start Game failure that exhausts its retries ends it.

### Combat

- **Copilot and copilot sets** — single plans use `prts://<id>`, sets use `prts://s<id>`. Search by link or stage name and preview the stage, squad and recommendation before running.
- **Set progress** — select stages, persist completed stages separately for normal and challenge mode, resume from the next stage, or reset progress.
- **Modes and options** — normal, challenge or both; preset squads are normal-only. Options include loop count, squad 1–4, trust fill, sanity medicine, ignoring level/skill requirements, support mode and a named support operator.
- **Execution feedback** — per-stage status, progress, kill count from battle OCR and elapsed time. Sets can run continuously or pause after each stage; a manual session survives a page refresh.
- **Current event** — discover the best matching set or per-stage fallback, validate MAA navigation resources, filter candidates against the local operator box, and track completion on the dashboard. A plan with two or more missing operators is skipped; a single missing operator can be covered when the support mode allows it.
- **SSS and Paradox Simulation** — run one SSS plan with a loop count, or search Paradox plans by operator with popularity and recommended results.

### Roguelike and Reclamation

- **Six Integrated Strategies themes** — Phantom, Mizuki, Sami, Sarkaz, JieGarden and Blackflow, plus a custom theme code.
- **Theme-aware modes** — score and ingot farming, first-floor reset, monthly squad and deep investigation, with additional modes for Sami, Sarkaz, JieGarden and Blackflow. The mode list follows the selected theme.
- **Starting lineup and strategy** — theme-specific squads and role groups, up to three starting operators with support per slot, difficulty, run count, stop conditions, investment options and theme-specific settings.
- **Reclamation Algorithm** — Tales Within the Sand and Restart Anchor with RA-1, RA-15 and RA-4 modes and their own parameters.
- **Draft-safe editing** — settings save after a short debounce, fall back to a local draft when the server is unavailable, and a running task is restored and polled every two seconds.

### Operators, depot and drops

- **Operator box** — run MAA OperBox recognition and keep owned/all counts, collection rate, elite, level and potential. Filter by ownership, rarity, class, elite and potential; Amiya's three forms count as one owned operator.
- **Depot** — run Depot recognition, see totals and category summaries, and browse the full inventory with icons and quantities.
- **Training plans** — build a queue, view the current target's material gap, and generate a farming plan for the current target or the whole queue. The plan lists open and closed stages, estimated runs and sanity, and can be applied to the daily flow as smart stages.
- **Drop records** — 3, 7, 14 or 30 day windows with total and average sanity, battle count, medicine, originium, top materials and per-stage details.
- **Material data** — refresh the local material, formula and operator-material JSON from the public ArknightsGameData repository when game data changes; training plans read MaaResource item data separately.

### Custom tools

- **Five focused tools** — pixel-art filling, automatic potential upgrades, missing-material synthesis, Phantom crown farming and event-shop exchange.
- **Pixel editor** — a 24×24 grid with colors 0–39, drag filling, per-cell delay and a confirmed clear.
- **Check before running** — parameter check returns the plan without starting MAA. A real run starts immediately and changes game or account state.

### Notifications and remote control

- **Telegram completion reports** — off by default. Turn on the channel, save a bot token and chat ID, and receive a summary with per-task results, drops, reports, warnings, skips and failures. A screenshot is attached only when the flow ran the Awards step; images over 10 MB or failed image sends fall back to text.
- **Bot commands** — `/status`, `/screenshot`, `/startup`, `/closedown`, `/fight`, `/roguelike`, `/copilot`, `/stop`, `/run` for saved flows, direct `prts://` links, and Chinese keyword aliases. Only the configured chat or user IDs are accepted.
- **Local secrets** — the bot token and chat ID are stored in the local notification config. Set `LA_PLUMA_TOKEN` and keep the console off untrusted networks when it is reachable beyond localhost.

### Agent API

- **Discoverable surface** — `/api/agent/manifest` and `/api/agent/openapi.json` are generated from one registry. The manifest advertises 26 public actions with risk, dry-run, polling and stop metadata; the OpenAPI document includes all registered operations.
- **Semantic actions** — status, connection test, device discovery, current-event preflight, start game, fight, daily flow, screenshots, recent logs, WebRTC preview and a custom-tool runner for five whitelisted tools, alongside a whitelisted `run-task` escape hatch.
- **Tracked runs** — consequential actions return a `runId`, `run`, `pollUrl` and `stopUrl`; background work returns HTTP 202. Runs and idempotency records are persisted before the external side effect starts, become non-retryable `interrupted` after a restart, and are retained for up to 24 hours or 500 records.
- **Safe execution** — `dryRun` returns the plan without starting MAA, `Idempotency-Key` replays the original run, and the shared MAA lease returns HTTP 409 when another La Pluma execution holds the device.

### Interface and deployment

- **Stack** — React 19, TypeScript, Vite, Tailwind CSS, Framer Motion and Zustand on the client; Node.js, Express and node-cron on the server.
- **Deployment** — local Node.js, a multi-arch Docker image (`linux/amd64`, `linux/arm64`), optional HTTPS, and subpath hosting.
- **PWA** — installable on HTTPS or localhost, with an offline UI shell. Automation and device control always require the backend.
- **Language** — the interface is currently in Chinese.

## Screenshots

<p align="center">
  <img src="screenshots/automation-web-theme-split.png" alt="Automation workspace on desktop with light and dark themes side by side" width="92%" />
  <br />
  <em>Automation workspace on desktop</em>
</p>

<p align="center">
  <img src="screenshots/automation-mobile-theme-split.png" alt="Automation workspace on a phone with light and dark themes side by side" width="36%" />
  <br />
  <em>The same workspace on a phone</em>
</p>

## Quick start

### Requirements

- **Node.js 22.12+** — the server runs TypeScript directly with `--experimental-strip-types`.
- **maa CLI with MaaCore** — install the CLI, then run `maa install` once. On macOS: `brew install MaaAssistantArknights/tap/maa-cli`.
- **ADB** — a system install or the copy bundled with your emulator. Point **Config → Connection** at it; the default path is the macOS Homebrew location.
- **Host** — macOS, Linux or Docker.

### Run locally

```bash
git clone https://github.com/mps233/La-pluma.git
cd La-pluma
npm run install:all

# Run these in separate terminals for reliable process cleanup
npm run dev:server
npm run dev:client
```

Open http://localhost:5173. Vite proxies `/api` and `/webrtc-signaling` to the server on port 3000.

For a production build served by Express:

```bash
npm run build
NODE_ENV=production npm run start --prefix server
```

### Run with Docker

```bash
docker pull miaona/la-pluma:latest

docker run -d \
  --name la-pluma \
  -p 3055:3000 \
  -v /path/to/data:/app/server/data \
  -v /path/to/maa-config:/root/.config/maa \
  -v /path/to/maa-data:/root/.local/share/maa \
  -e ADB_PATH=/usr/bin/adb \
  -e ADB_ADDRESS=192.168.1.10:5555 \
  miaona/la-pluma:latest
```

Open http://localhost:3055. `ADB_ADDRESS` must point at the host or emulator from inside the container; with the default bridge network, `127.0.0.1` refers to the container itself. The `ADB_PATH` override is required in Docker because the image installs ADB at `/usr/bin/adb`.

The image installs MaaCore on first start when it is missing. `docker-compose.yml` is also included; edit its host paths and ADB address, and add `ADB_PATH=/usr/bin/adb` under `environment`, before running `docker compose up -d`.

## Configuration

Connection settings live in **Config → Connection**: ADB path and address, client type, touch mode, auto-reconnect and connection presets. **Find emulator** scans ADB and common local ports.

Key environment variables:

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Server port | `3000` |
| `ADB_PATH` | ADB executable | `/opt/homebrew/bin/adb` |
| `ADB_ADDRESS` | Default ADB device address | `127.0.0.1:16384` |
| `MAA_CLI_PATH` | `maa` executable | `maa`; Docker uses `/usr/local/bin/maa` |
| `MAA_CLIENT_TYPE` | Default client | `Official` |
| `LA_PLUMA_TOKEN` | Require a bearer token or `X-La-Pluma-Token` on `/api` (except public `/api/maa-assets`) and the WebRTC ticket endpoint | empty, auth off |
| `LA_PLUMA_AGENT_RUN_STORE` | Run and idempotency store | `server/data/agent-runs.json` |
| `LA_PLUMA_BASE_PATH` | Runtime mount path; must match the build-time `VITE_BASE_PATH` | `/` |
| `LA_PLUMA_HTTPS_CERT_PATH` | Certificate chain; set together with the key | empty, HTTP |
| `LA_PLUMA_HTTPS_KEY_PATH` | Private key; set together with the chain | empty, HTTP |
| `LA_PLUMA_WEBRTC_DIR` | ScrcpyOverWebRTC working directory | `$HOME/ScrcpyOverWebRTC` |
| `LA_PLUMA_WEBRTC_PORT` | ScrcpyOverWebRTC port | `8443` |
| `LA_PLUMA_WEBRTC_VERSION` | Install or upgrade release; `latest` follows stable | `latest` |
| `LA_PLUMA_MAX_REALTIME_LOGS` | In-memory log line cap | `5000` |

<details>
<summary>HTTPS, subpath hosting and WebRTC notes</summary>

**HTTPS.** Set both `LA_PLUMA_HTTPS_CERT_PATH` and `LA_PLUMA_HTTPS_KEY_PATH` to start the server over HTTPS; setting only one aborts startup. PWA installation and offline caching require HTTPS or `localhost`. If TLS terminates at a reverse proxy, forward `/api`, `/health` and `/webrtc-signaling`, including the WebSocket upgrade for the last one.

**Subpath.** Build with `VITE_BASE_PATH=/la-pluma/` and run with `LA_PLUMA_BASE_PATH=/la-pluma/`. Docker accepts the build argument `VITE_BASE_PATH`. The API, health check and signaling gateway stay at the origin root.

**WebRTC.** Browser preview uses the same-origin `/webrtc-signaling` gateway, so the upstream admin credential stays in the backend. The signaling ticket is single-use and expires after 15 seconds. Component install and upgrade download a GitHub release, verify its SHA256, preserve `data/` and `certs/`, and back up the previous directory. Stop the service before installing. Device agents older than `v0.4.3` are reported as outdated.

</details>

## Usage

1. Configure the emulator connection in **Config**.
2. Add tasks to the flow in **Automation**, then run it once or add daily times.
3. Use **Combat** for copilot plans and **Roguelike** for Integrated Strategies or Reclamation.
4. Watch progress in **Logs**, or keep **Console** open for status, drops and the optional preview.

### Agent API

```bash
# Discover actions and read a compact status
curl http://localhost:3000/api/agent/manifest
curl http://localhost:3000/api/agent/status

# Check a fight plan without starting MAA
curl -X POST http://localhost:3000/api/agent/actions/fight \
  -H 'Content-Type: application/json' \
  -d '{"stages":[{"stage":"1-7","times":3}],"dryRun":true}'

# Run the saved daily flow with idempotency
curl -X POST http://localhost:3000/api/agent/actions/run-daily-flow \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: daily-flow-20261104-01' \
  -d '{}'

# Poll the current run, then stop a specific run when needed
curl 'http://localhost:3000/api/agent/runs/current?lines=80'
curl -X POST http://localhost:3000/api/agent/runs/<runId>/stop
```

When `LA_PLUMA_TOKEN` is set, send `Authorization: Bearer <token>` or `X-La-Pluma-Token`. `/health` and the read-only `/api/maa-assets` image routes stay public so the UI can load item and avatar images.

## Project structure

```text
La-pluma/
├─ client/                 React + TypeScript + Vite frontend
│  ├─ src/components/      Dashboard, automation, combat, roguelike, training, data, tools
│  ├─ src/services/api.ts  /api/agent client
│  ├─ src/stores/          Zustand stores
│  └─ public/              PWA icons and logo
├─ server/                 Express backend
│  ├─ routes/              agent.ts, agentContract.ts, operatorQuotes.ts, maaAssets.ts
│  ├─ services/            MAA, scheduler, runs, WebRTC, training, notifications, data
│  ├─ data/                Local configuration and runtime data (not committed)
│  └─ server.ts            Entry point
├─ screenshots/            README images
├─ docs/                   MAA integration notes
├─ Dockerfile
├─ docker-compose.yml
└─ package.json
```

## Documentation

| Document | Contents |
| --- | --- |
| `README.md` | English overview, setup, deployment and Agent API |
| `README.zh.md` | Chinese version of this file |
| `AGENTS.md` | Repository rules and verification commands for coding agents |
| `DESIGN.md` | Visual and component specification |
| `client/src/components/common/README.md` | Shared component props and examples |
| `server/README.md` | Server helpers and data scripts |
| `docs/maa.md` | MAA CLI/Core integration status, boundaries and known gaps |

## License

MIT License.

## Acknowledgements

- [MAA (MaaAssistantArknights)](https://github.com/MaaAssistantArknights/MaaAssistantArknights) — the automation engine.
- [maa-cli](https://github.com/MaaAssistantArknights/maa-cli) — the command-line interface La Pluma drives.
- [ScrcpyOverWebRTC](https://github.com/hqw700/ScrcpyOverWebRTC) — browser preview and device control.
- [PenguinStats](https://penguin-stats.io/) and [PRTS](https://prts.maa.plus/) — drop data and copilot plans.
