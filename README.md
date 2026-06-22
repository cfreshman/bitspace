# BITSPACE

BITSPACE is a 1-bit, socket-based competitive arena scaffold for up to eight players.

## Local Development

```sh
npm install
npm run dev
```

The app defaults to port `7024` locally and in production. Set `PORT` or `BITSPACE_PORT` to override it.

## Engine Shape

- The server is authoritative and advances a `60 Hz` arena tick using elapsed `dt`.
- Clients send normalized WASD movement vectors, mouse aim angle, and mining-ray hold state. The server owns session state, debug movement, and snapshots.
- The browser renders a square `384x384` logical 1-bit framebuffer: `24x24` visible tiles at `16px` each.
- The page only displays a literal `object-fit: contain` canvas on a black page background.
- Shared modules in `shared/` are imported by both the server and browser.

The current scaffold intentionally avoids game mechanics. There is low-drift debug ship movement, procedural 1-bit line-sphere ship art, a shared booster particle plume, a deterministic parallax star field, dashed map bounds, and a visual mining ray to validate input, networking, camera, and rendering. Future mechanics should be added only after they are explicitly designed.

## Deployment

### Raspberry Pi

The Pi target is expected to have `pm2` and `nginx` already installed. Deploys run from this machine and sync the local workspace to the remote app directory:

```sh
./scripts/deploy.sh
```

Defaults:

- SSH target: `cyrus@rain.remote`
- SSH port: `7006`
- Remote directory: `/home/cyrus/bitspace`
- App port: `7024`
- PM2 process name: `bitspace`

Override with `BITSPACE_REMOTE_HOST`, `BITSPACE_REMOTE_SSH_PORT`, `BITSPACE_REMOTE_DIR`, `BITSPACE_PORT`, and `BITSPACE_PM2_NAME`.

### DigitalOcean

The DigitalOcean path is separate from the Pi path and targets Ubuntu 24 droplets over normal SSH. Set the droplet SSH target, then deploy:

```sh
BITSPACE_DO_HOST=root@203.0.113.10 ./scripts/deploy-digitalocean.sh
```

or:

```sh
BITSPACE_DO_HOST=root@203.0.113.10 npm run deploy:do
```

Defaults:

- SSH target: required via `BITSPACE_DO_HOST`, such as `root@<ip>` or `ubuntu@<ip>`
- SSH port: `22`
- Remote directory: `/opt/bitspace` for `root`, otherwise `/home/<user>/bitspace`
- App port: `7024`
- PM2 process name: `bitspace`
- Bootstrap: enabled, installs Node 20 and `pm2` if missing

Override with `BITSPACE_DO_SSH_PORT`, `BITSPACE_DO_REMOTE_DIR`, `BITSPACE_DO_PORT`, `BITSPACE_DO_PM2_NAME`, and `BITSPACE_DO_BOOTSTRAP=0`.

Check the deployed process with:

```sh
BITSPACE_DO_HOST=root@203.0.113.10 ./scripts/remote-status-digitalocean.sh
```
