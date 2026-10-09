# BITSPACE

**8-person space-battle arena.**

[Play BITSPACE](https://bitspace.freshman.dev/) · [freshman.dev](https://freshman.dev/)

Fly through asteroid caves, mine resources, upgrade your ship, build walls, and fight other players. Mining rays double as weapons, thrown rocks bounce through the arena, and a closing storm forces survivors into a smaller space. The last player alive wins.

Play online with up to eight people, share a named room with friends, or practice against bots in your browser. The game supports keyboard and mouse, gamepads, and touch controls, with procedural graphics, selectable themes, music, and sound effects.

## Playing

- **READY** joins a public lobby for the selected game mode.
- **ROOM** creates or joins a room using a shared key. Share the resulting URL to bring others into the same room. Named rooms queue late arrivals and return to the lobby after a match.
- **BOTS** starts a local lobby with one to seven bots. Adjust the count with `Q` / `E` or controller D-pad left / right before starting. Local bot matches are saved in browser storage and can resume after a refresh.

Online matches require at least two players. The lobby host can start with `Enter` or the START control; a full lobby or the lobby timer also starts the countdown. Players can move around and interact in the waiting arena without damaging each other. Each match starts with a fresh arena and player loadout. Eliminated players spectate until the match ends or they leave.

### Resources and upgrades

Mine **ROCK**, **ORE**, and **DIAMOND** from the asteroid field. Rock supplies wall building and thrown-rock attacks. Ore and diamonds buy upgrades:

- **ENGINES** — faster movement.
- **MINING RANGE** — longer rays.
- **RAY POWER** — faster mining and more ray damage.
- **HEALTH** — additional health bars.
- **REGENERATION** — health recovery after a pause in incoming damage.
- **AUXILIARY RAYS** — additional side mining rays.

Text chat appears as talk bubbles. Online voice chat uses WebRTC and follows player visibility during play; eliminated players hear other eliminated players, and the ended room allows everyone to talk.

Voice starts **off on each page load**. Enable it through the voice HUD item, `V`, or right-stick click (`R3`). The PREFS menu includes microphone capture, voice/music/effects volumes, master volume, and desktop HUD placement.

### Controls

These are the main arena controls. Controller button names use the standard Xbox / PlayStation layout.

| Action | Keyboard / mouse | Controller |
| --- | --- | --- |
| Move / steer | `WASD` or arrow keys | Left stick |
| Aim | Mouse | Right stick |
| Mine / primary attack | Hold mouse button | Right trigger (`RT` / `R2`) |
| Throw rock / secondary attack | `Space` | Left trigger (`LT` / `L2`) |
| Open upgrades | `Q`; hover and click to buy | Top face button (`Y` / triangle); D-pad to select, bottom face button to buy |
| Toggle build mode | `E`; aim and hold mouse button to place walls | Left face button (`X` / square); aim and use right trigger |
| Expand / collapse map (when enabled) | `M` | D-pad up |
| Toggle voice | `V` or click the voice HUD item | Right-stick click (`R3`) |
| Start a lobby as host | `Enter` or START control | Bottom face button (`A` / cross) |
| Leave / back | `Escape`; confirm when prompted | Right face button (`B` / circle) |
| Change spectated player | `A` / `D` or left / right arrows | D-pad left / right |

Press `T` to edit a talk bubble, `Enter` to send, or `Escape` to cancel. The upgrade panel blocks attacks while open; desktop movement remains available.

On touch devices, use the left virtual stick to move and the right virtual stick to aim and use the primary attack. Tap the arena to use the secondary attack, and tap the HUD actions for upgrades, building, leaving, voice, and the map when enabled.

The exploration map is implemented but currently disabled by default. Enable it with `controls.debugMap(true)` in the browser console to use the map controls.

### Alternate modes

The project includes several modes with their own movement, art, or combat rules. BUGS and OCTOS are available in the menu; the other variants can be selected through URL parameters.

| Mode | Select with | Main differences |
| --- | --- | --- |
| SHIPS | Default | Space arena, ship movement, mining, upgrades, and survival combat |
| BUGS | Menu | Leg-driven movement and procedural bug art |
| OCTOS | Menu or `?mode=octos` | Octopus art, animated tentacles, and underwater rendering |
| CARS | `?mode=cars` | Steering and driving physics |
| SUBS | `?mode=subs` or `?mode=subs2` | Submarine movement and underwater rendering |
| SKY | `?mode=sky` | Flight physics and cloud rendering |
| LASER TAG | `?mode=laser` | Red / blue teams, tagging, respawns, gate targets, and score- or time-based matches |

Laser Tag uses authored PNG maps and its own scoring rules rather than mining, upgrades, building, and the survival storm. Map colors and markers are documented in [the map palette](public/maps/laser-tag/PALETTE.md).

## Local development

Requires **Node.js 20 or newer** and npm.

```sh
git clone git@github.com:cfreshman/bitspace.git
cd bitspace
npm ci
npm run dev
```

Open [http://localhost:7024](http://localhost:7024). `npm run dev` watches the server; `npm start` runs it without watching.

The browser uses native JavaScript modules, so there is no frontend bundle step. Generated WebAssembly files are checked in under `public/wasm/`.

Configuration comes from process environment variables:

| Variable | Purpose |
| --- | --- |
| `PORT` / `BITSPACE_PORT` | Listening port; defaults to `7024`, with `PORT` taking precedence |
| `BITSPACE_SEED` | Base seed for reproducible arena generation; otherwise a seed is generated and logged at startup |
| `NODE_ENV` | Node environment; the PM2 configuration uses `production` |

For example, `BITSPACE_SEED=example npm run dev` uses a fixed base seed. `.env.example` lists example settings; the server does not automatically load an `.env` file.

### Checks and native core

| Command | What it does |
| --- | --- |
| `npm run check` | Checks JavaScript syntax across the server, shared modules, client, and smoke scripts |
| `npm test` | Checks microphone cancellation, reconnect/leave handling, packet validation, controller input, voice controls, and snapshot cleanup without starting the app |
| `npm run smoke:core` | Exercises the WebAssembly trajectory, visibility, geometry, and storm helpers |
| `npm run smoke:socket` | Connects to an already-running server, joins a lobby, checks a player snapshot, sends input, and leaves |
| `npm run build:core` | Rebuilds the C++ core into `public/wasm/bitspace_core.js` and `.wasm` |

The socket smoke check defaults to `http://localhost:7024`. Set `BITSPACE_SMOKE_URL` to test another running instance and `BITSPACE_SMOKE_TIMEOUT_MS` to change its timeout.

Rebuilding the native core requires Emscripten's `em++` on `PATH`. Ordinary JavaScript changes do not require a native rebuild.

## Project structure

| Path | Responsibility |
| --- | --- |
| `public/client.js` | Input, menus, client prediction, local bot matches, browser storage, audio, and WebRTC voice |
| `public/renderer.js` | World and HUD rendering, procedural art, themes, effects, and GPU presentation |
| `public/maps/laser-tag/` | PNG maps and their palette specification |
| `server/index.js` | Express routes, Socket.IO events, room broadcasts, and the simulation loop |
| `server/rooms.js` | Client identity, public and named rooms, queues, lobbies, match starts, and winners |
| `shared/` | Arena simulation, generation, physics, bots, upgrades, visibility, and network data formats |
| `core/bitspace_core.cpp` | C++ helpers for trajectory planning, pathfinding, visibility, geometry, and storm rendering |
| `scripts/` | Deployment, native builds, remote status, and smoke checks |

Online simulation runs authoritatively on the Node server at 60 Hz. Clients send inputs and receive snapshots and terrain updates, using prediction and interpolation for responsive movement. Local bot games run the shared simulation in the browser.

Online rooms live in server memory; restarting the server ends those rooms. Browser storage preserves client identity, preferences, explored maps, and local bot saves. No database is required.

The `/health` endpoint reports server health, uptime, seed, loaded Laser Tag maps, and room status.

## Deployment

Deployment scripts run locally from the project directory and use `rsync` over SSH. They run syntax, regression, and native-core checks before uploading, install production npm dependencies, start or reload the `bitspace` PM2 process on port `7024`, and check the running server's health.

### DigitalOcean

The configured production site is [bitspace.freshman.dev](https://bitspace.freshman.dev/). `scripts/config.sh` sets the default SSH host and domain; the default app directory for a root SSH user is `/opt/bitspace`.

For an already-provisioned host:

```sh
npm run deploy:do
npm run status:do
```

For first-time provisioning, run `BITSPACE_DO_BOOTSTRAP=1 npm run deploy:do` to set up Node, PM2, nginx, firewall rules, and HTTPS certificates. Normal deployments skip provisioning. Set `BITSPACE_DO_HOST`, `BITSPACE_DO_DOMAIN`, `BITSPACE_DO_REMOTE_DIR`, `BITSPACE_DO_SSH_PORT`, `BITSPACE_DO_PORT`, or `BITSPACE_DO_PM2_NAME` to change the target. `BITSPACE_DO_CERTBOT_EMAIL` supplies the certificate contact email.

### Raspberry Pi

```sh
./scripts/deploy.sh
./scripts/remote-status.sh
```

Defaults are `cyrus@rain.remote`, SSH port `7006`, app directory `/home/cyrus/bitspace`, and app port `7024`. PM2 and nginx are expected to be installed already.

Override the target with `BITSPACE_REMOTE_HOST`, `BITSPACE_REMOTE_SSH_PORT`, `BITSPACE_REMOTE_DIR`, `BITSPACE_PORT`, and `BITSPACE_PM2_NAME`.
