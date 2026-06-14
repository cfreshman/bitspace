# BITSPACE

BITSPACE is a 1-bit, socket-based competitive arena scaffold for up to four players.

## Local Development

```sh
npm install
npm run dev
```

The app defaults to port `7023` locally and in production. Set `PORT` or `BITSPACE_PORT` to override it.

## Engine Shape

- The server is authoritative and advances a `60 Hz` arena tick using elapsed `dt`.
- Clients send normalized WASD movement vectors, mouse aim angle, and mining-ray hold state. The server owns session state, debug movement, and snapshots.
- The browser renders a square `384x384` logical 1-bit framebuffer: `24x24` visible tiles at `16px` each.
- The page only displays a literal `object-fit: contain` canvas on a black page background.
- Shared modules in `shared/` are imported by both the server and browser.

The current scaffold intentionally avoids game mechanics. There is low-drift debug ship movement, procedural 1-bit line-sphere ship art, a shared booster particle plume, a deterministic parallax star field, dashed map bounds, and a visual mining ray to validate input, networking, camera, and rendering. Future mechanics should be added only after they are explicitly designed.

## Deployment

The Pi target is expected to have `pm2` and `nginx` already installed. Deploys run from this machine and sync the local workspace to the remote app directory:

```sh
./scripts/deploy.sh
```

Defaults:

- SSH target: `cyrus@rain.remote`
- SSH port: `7006`
- Remote directory: `/home/cyrus/bitspace`
- App port: `7023`
- PM2 process name: `bitspace`

Override with `BITSPACE_REMOTE_HOST`, `BITSPACE_REMOTE_SSH_PORT`, `BITSPACE_REMOTE_DIR`, `BITSPACE_PORT`, and `BITSPACE_PM2_NAME`.
