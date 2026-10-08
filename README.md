# BITSPACE

## Local Development

```sh
npm install
npm run dev
```

The app defaults to port `7024` locally and in production. Set `PORT` or `BITSPACE_PORT` to override it.

## Engine Shape

- The server is authoritative and advances a `60 Hz` arena tick using elapsed `dt`.
- Clients send normalized WASD movement vectors, mouse aim angle, and mining-ray hold state. The server owns session state, debug movement, and snapshots.
- The page only displays a literal `object-fit: contain` canvas on a black page background.
- Shared modules in `shared/` are imported by both the server and browser.

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

The DigitalOcean path is separate from the Pi path and targets Ubuntu 24 droplets over normal SSH. The default target is configured in `scripts/config.sh`, so deploy with:

```sh
./scripts/deploy-digitalocean.sh
```

or:

```sh
npm run deploy:do
```

Defaults:

- SSH target: `root@142.93.122.18`
- Domain: `bitspace.freshman.dev`
- SSH port: `22`
- Remote directory: `/opt/bitspace` for `root`, otherwise `/home/<user>/bitspace`
- App port: `7024`
- PM2 process name: `bitspace`
- Bootstrap: enabled, installs Node 20, `pm2`, nginx, UFW, certbot, and PM2 systemd startup if missing
- Web bootstrap: enabled, configures nginx to proxy HTTPS to `127.0.0.1:7024`, redirects HTTP to HTTPS, and opens SSH/80/443 in UFW

Override with `BITSPACE_DO_SSH_PORT`, `BITSPACE_DO_REMOTE_DIR`, `BITSPACE_DO_PORT`, `BITSPACE_DO_PM2_NAME`, `BITSPACE_DO_CERTBOT_EMAIL`, `BITSPACE_DO_BOOTSTRAP=0`, and `BITSPACE_DO_CONFIGURE_WEB=0`.

Check the deployed process with:

```sh
./scripts/remote-status-digitalocean.sh
```
