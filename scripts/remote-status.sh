#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${BITSPACE_REMOTE_HOST:-cyrus@rain.remote}"
REMOTE_SSH_PORT="${BITSPACE_REMOTE_SSH_PORT:-7006}"
PM2_NAME="${BITSPACE_PM2_NAME:-bitspace}"

ssh -p "${REMOTE_SSH_PORT}" "${REMOTE_HOST}" "pm2 describe '${PM2_NAME}' && pm2 logs '${PM2_NAME}' --lines 40 --nostream"
