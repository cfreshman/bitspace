#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${BITSPACE_DO_HOST:-}" ]]; then
  echo "Set BITSPACE_DO_HOST to the droplet SSH target, e.g. root@203.0.113.10" >&2
  exit 2
fi

REMOTE_HOST="${BITSPACE_DO_HOST}"
REMOTE_SSH_PORT="${BITSPACE_DO_SSH_PORT:-22}"
PM2_NAME="${BITSPACE_DO_PM2_NAME:-bitspace}"

ssh -p "${REMOTE_SSH_PORT}" "${REMOTE_HOST}" "pm2 describe '${PM2_NAME}' && pm2 logs '${PM2_NAME}' --lines 40 --nostream"
