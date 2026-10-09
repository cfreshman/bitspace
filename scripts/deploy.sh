#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BITSPACE_PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${BITSPACE_PROJECT_DIR}"

REMOTE_HOST="${BITSPACE_REMOTE_HOST:-cyrus@rain.remote}"
REMOTE_SSH_PORT="${BITSPACE_REMOTE_SSH_PORT:-7006}"
REMOTE_DIR="${BITSPACE_REMOTE_DIR:-/home/cyrus/bitspace}"
PM2_NAME="${BITSPACE_PM2_NAME:-bitspace}"
APP_PORT="${BITSPACE_PORT:-7024}"
SSH_COMMAND=(ssh -p "${REMOTE_SSH_PORT}")
RSYNC_RSH="ssh -p ${REMOTE_SSH_PORT}"

npm run check
npm test
npm run smoke:core

echo "Deploying BITSPACE to ${REMOTE_HOST}:${REMOTE_DIR}"

"${SSH_COMMAND[@]}" "${REMOTE_HOST}" "mkdir -p '${REMOTE_DIR}'"

rsync -az --delete \
  --exclude ".git/" \
  --exclude ".env" \
  --exclude "node_modules/" \
  --exclude "npm-debug.log*" \
  -e "${RSYNC_RSH}" \
  ./ "${REMOTE_HOST}:${REMOTE_DIR}/"

"${SSH_COMMAND[@]}" "${REMOTE_HOST}" "\
  cd '${REMOTE_DIR}' && \
  npm ci --omit=dev && \
  BITSPACE_PM2_NAME='${PM2_NAME}' BITSPACE_PORT='${APP_PORT}' pm2 startOrReload ecosystem.config.cjs --update-env && \
  pm2 save && \
  curl --fail --silent --show-error --retry 5 --retry-delay 1 --retry-connrefused 'http://127.0.0.1:${APP_PORT}/health' >/dev/null"

echo "BITSPACE deployed as pm2 process ${PM2_NAME} on port ${APP_PORT}"
