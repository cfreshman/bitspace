#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BITSPACE_PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${BITSPACE_PROJECT_DIR}"
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
BOOTSTRAP="${BITSPACE_DO_BOOTSTRAP:-0}"
CONFIGURE_WEB="${BITSPACE_DO_CONFIGURE_WEB:-1}"
DOMAIN="${BITSPACE_DO_DOMAIN:-${BITSPACE_DOMAIN:-}}"
CERTBOT_EMAIL="${BITSPACE_DO_CERTBOT_EMAIL:-${CERTBOT_EMAIL:-}}"
SSH_COMMAND=(ssh -p "${REMOTE_SSH_PORT}")
RSYNC_RSH="ssh -p ${REMOTE_SSH_PORT}"

if [[ "${CONFIGURE_WEB}" != "0" && -z "${DOMAIN}" ]]; then
  echo "Set BITSPACE_DO_DOMAIN to the HTTPS domain, or set BITSPACE_DO_CONFIGURE_WEB=0 to skip nginx/certbot/ufw." >&2
  exit 2
fi

shell_quote() {
  printf "%q" "$1"
}

REMOTE_DIR_Q="$(shell_quote "${REMOTE_DIR}")"
PM2_NAME_Q="$(shell_quote "${PM2_NAME}")"
APP_PORT_Q="$(shell_quote "${APP_PORT}")"
REMOTE_SSH_PORT_Q="$(shell_quote "${REMOTE_SSH_PORT}")"
CONFIGURE_WEB_Q="$(shell_quote "${CONFIGURE_WEB}")"
DOMAIN_Q="$(shell_quote "${DOMAIN}")"
CERTBOT_EMAIL_Q="$(shell_quote "${CERTBOT_EMAIL}")"

npm run check
npm test
npm run smoke:core

echo "Deploying BITSPACE to DigitalOcean ${REMOTE_HOST}:${REMOTE_DIR}"

if [[ "${BOOTSTRAP}" != "0" ]]; then
  "${SSH_COMMAND[@]}" "${REMOTE_HOST}" "\
BITSPACE_REMOTE_DIR=${REMOTE_DIR_Q} \
BITSPACE_APP_PORT=${APP_PORT_Q} \
BITSPACE_REMOTE_SSH_PORT=${REMOTE_SSH_PORT_Q} \
BITSPACE_CONFIGURE_WEB=${CONFIGURE_WEB_Q} \
BITSPACE_DOMAIN=${DOMAIN_Q} \
BITSPACE_CERTBOT_EMAIL=${CERTBOT_EMAIL_Q} \
bash -s" <<'REMOTE_BOOTSTRAP'
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

if [[ "${BITSPACE_CONFIGURE_WEB}" != "0" ]]; then
  run_root apt-get update
  run_root apt-get install -y nginx ufw certbot python3-certbot-nginx

  run_root ufw allow "${BITSPACE_REMOTE_SSH_PORT}/tcp"
  run_root ufw allow 80/tcp
  run_root ufw allow 443/tcp
  run_root ufw --force enable

  run_root mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
  run_root tee /etc/nginx/sites-available/bitspace >/dev/null <<NGINX
server {
  listen 80;
  listen [::]:80;
  server_name ${BITSPACE_DOMAIN};

  location / {
    proxy_pass http://127.0.0.1:${BITSPACE_APP_PORT};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 75s;
    proxy_send_timeout 75s;
  }
}
NGINX
  run_root ln -sf /etc/nginx/sites-available/bitspace /etc/nginx/sites-enabled/bitspace
  run_root rm -f /etc/nginx/sites-enabled/default
  run_root nginx -t
  run_root systemctl reload nginx || run_root systemctl restart nginx

  certbot_args=(--nginx -d "${BITSPACE_DOMAIN}" --non-interactive --agree-tos --redirect --keep-until-expiring)
  if [[ -n "${BITSPACE_CERTBOT_EMAIL}" ]]; then
    certbot_args+=(--email "${BITSPACE_CERTBOT_EMAIL}" --no-eff-email)
  else
    certbot_args+=(--register-unsafely-without-email)
  fi
  run_root certbot "${certbot_args[@]}"
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
BITSPACE_REMOTE_DIR=${REMOTE_DIR_Q} \
BITSPACE_PM2_NAME=${PM2_NAME_Q} \
BITSPACE_APP_PORT=${APP_PORT_Q} \
BITSPACE_BOOTSTRAP=$(shell_quote "${BOOTSTRAP}") \
bash -s" <<'REMOTE_DEPLOY'
set -euo pipefail

run_root() {
  if [[ "$(id -u)" == "0" ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

cd "${BITSPACE_REMOTE_DIR}"
npm ci --omit=dev
BITSPACE_PM2_NAME="${BITSPACE_PM2_NAME}" BITSPACE_PORT="${BITSPACE_APP_PORT}" pm2 startOrReload ecosystem.config.cjs --update-env

if [[ "${BITSPACE_BOOTSTRAP}" != "0" ]]; then
  pm2_user="$(id -un)"
  pm2_home="$(getent passwd "${pm2_user}" | cut -d: -f6 || true)"
  if [[ -z "${pm2_home}" ]]; then
    pm2_home="${HOME}"
  fi
  run_root env PATH="${PATH}" pm2 startup systemd -u "${pm2_user}" --hp "${pm2_home}"
fi
pm2 save
curl --fail --silent --show-error --retry 5 --retry-delay 1 --retry-connrefused \
  "http://127.0.0.1:${BITSPACE_APP_PORT}/health" >/dev/null
REMOTE_DEPLOY

echo "BITSPACE deployed to DigitalOcean as pm2 process ${PM2_NAME} on port ${APP_PORT}"
