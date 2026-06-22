#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${BITSPACE_DO_HOST:-}" ]]; then
  echo "Set BITSPACE_DO_HOST to the droplet SSH target, e.g. root@203.0.113.10" >&2
  exit 2
fi

REMOTE_HOST="${BITSPACE_DO_HOST}"
REMOTE_SSH_PORT="${BITSPACE_DO_SSH_PORT:-22}"
REMOTE_USER="${REMOTE_HOST%@*}"
if [[ "${REMOTE_USER}" == "${REMOTE_HOST}" ]]; then
  REMOTE_USER="root"
fi
if [[ "${REMOTE_USER}" == "root" ]]; then
  DEFAULT_REMOTE_DIR="/opt/bitspace"
else
  DEFAULT_REMOTE_DIR="/home/${REMOTE_USER}/bitspace"
fi
REMOTE_DIR="${BITSPACE_DO_REMOTE_DIR:-${DEFAULT_REMOTE_DIR}}"
PM2_NAME="${BITSPACE_DO_PM2_NAME:-bitspace}"
APP_PORT="${BITSPACE_DO_PORT:-${BITSPACE_PORT:-7024}}"
BOOTSTRAP="${BITSPACE_DO_BOOTSTRAP:-1}"
SSH_COMMAND=(ssh -p "${REMOTE_SSH_PORT}")
RSYNC_RSH="ssh -p ${REMOTE_SSH_PORT}"

shell_quote() {
  printf "%q" "$1"
}

REMOTE_DIR_Q="$(shell_quote "${REMOTE_DIR}")"
PM2_NAME_Q="$(shell_quote "${PM2_NAME}")"
APP_PORT_Q="$(shell_quote "${APP_PORT}")"

echo "Deploying BITSPACE to DigitalOcean ${REMOTE_HOST}:${REMOTE_DIR}"

if [[ "${BOOTSTRAP}" != "0" ]]; then
  "${SSH_COMMAND[@]}" "${REMOTE_HOST}" "BITSPACE_REMOTE_DIR=${REMOTE_DIR_Q} bash -s" <<'REMOTE_BOOTSTRAP'
set -euo pipefail

run_root() {
  if [[ "$(id -u)" == "0" ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

node_ok=0
if command -v node >/dev/null 2>&1; then
  node_major="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)"
  if [[ "${node_major}" -ge 20 ]]; then
    node_ok=1
  fi
fi

if [[ "${node_ok}" != "1" ]]; then
  run_root apt-get update
  run_root apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_20.x -o /tmp/bitspace-nodesource-setup.sh
  run_root bash /tmp/bitspace-nodesource-setup.sh
  run_root apt-get install -y nodejs
fi

if ! command -v pm2 >/dev/null 2>&1; then
  run_root npm install -g pm2
fi

run_root mkdir -p "${BITSPACE_REMOTE_DIR}"
if [[ "$(id -u)" != "0" ]]; then
  run_root chown -R "$(id -un):$(id -gn)" "${BITSPACE_REMOTE_DIR}"
fi
REMOTE_BOOTSTRAP
else
  "${SSH_COMMAND[@]}" "${REMOTE_HOST}" "mkdir -p ${REMOTE_DIR_Q}"
fi

rsync -az --delete \
  --exclude ".git/" \
  --exclude ".env" \
  --exclude "node_modules/" \
  --exclude "npm-debug.log*" \
  -e "${RSYNC_RSH}" \
  ./ "${REMOTE_HOST}:${REMOTE_DIR}/"

"${SSH_COMMAND[@]}" "${REMOTE_HOST}" "\
  cd ${REMOTE_DIR_Q} && \
  npm ci --omit=dev && \
  BITSPACE_PM2_NAME=${PM2_NAME_Q} BITSPACE_PORT=${APP_PORT_Q} pm2 startOrReload ecosystem.config.cjs --update-env && \
  pm2 save"

echo "BITSPACE deployed to DigitalOcean as pm2 process ${PM2_NAME} on port ${APP_PORT}"
