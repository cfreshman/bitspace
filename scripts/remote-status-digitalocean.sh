#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${SCRIPT_DIR}/config.sh" ]]; then
  # shellcheck source=/dev/null
  source "${SCRIPT_DIR}/config.sh"
fi

if [[ -z "${BITSPACE_DO_HOST:-}" ]]; then
  echo "Set BITSPACE_DO_HOST to the droplet SSH target, e.g. root@203.0.113.10" >&2
  exit 2
fi

REMOTE_HOST="${BITSPACE_DO_HOST}"
REMOTE_SSH_PORT="${BITSPACE_DO_SSH_PORT:-22}"
PM2_NAME="${BITSPACE_DO_PM2_NAME:-bitspace}"

ssh -p "${REMOTE_SSH_PORT}" "${REMOTE_HOST}" "\
  PM2_SERVICE=pm2-\$(id -un); \
  if command -v systemctl >/dev/null 2>&1; then \
    echo \"PM2 startup service: \${PM2_SERVICE}\"; \
    systemctl is-enabled \"\${PM2_SERVICE}\" 2>/dev/null || true; \
    systemctl is-active \"\${PM2_SERVICE}\" 2>/dev/null || true; \
  fi; \
  pm2 describe '${PM2_NAME}' && pm2 logs '${PM2_NAME}' --lines 40 --nostream"
