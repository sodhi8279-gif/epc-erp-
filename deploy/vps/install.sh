#!/usr/bin/env bash
# EPC Contracts & Billing — VPS installer for Ubuntu 22.04 / 24.04 (run as root from the extracted release folder).
#
#   sudo ./deploy/vps/install.sh --domain erp.example.com --email you@example.com \
#        --admin-email admin@example.com --company "Your EPC Company Pvt Ltd"
#
# Installs PostgreSQL, Node.js 22, nginx; builds the app into /opt/epc-erp; creates the database with a random
# password; runs migrations; creates the first super administrator; registers a systemd service; puts nginx in
# front (HTTPS via Let's Encrypt when --domain is given); enables the firewall and daily backups.
# Safe to re-run: existing database, secrets and data are kept.
set -euo pipefail

DOMAIN=""; LE_EMAIL=""; ADMIN_EMAIL=""; ADMIN_PASSWORD=""; COMPANY="Your EPC Company"; COMPANY_CODE="HQ"
APP_DIR=/opt/epc-erp; ETC=/etc/epc-erp; DATA=/var/lib/epc-erp; DB=epc; DBUSER=epc; PORT=4000
SKIP_SYSTEM=${SKIP_SYSTEM:-0}   # 1 = do not touch apt/nginx/systemd/ufw (used for testing in containers)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2;;
    --email) LE_EMAIL="$2"; shift 2;;
    --admin-email) ADMIN_EMAIL="$2"; shift 2;;
    --admin-password) ADMIN_PASSWORD="$2"; shift 2;;
    --company) COMPANY="$2"; shift 2;;
    --company-code) COMPANY_CODE="$2"; shift 2;;
    --app-dir) APP_DIR="$2"; shift 2;;
    --db) DB="$2"; DBUSER="$2"; shift 2;;
    --port) PORT="$2"; shift 2;;
    -h|--help) sed -n '2,12p' "$0"; exit 0;;
    *) echo "Unknown option $1"; exit 1;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "Run as root (sudo)."; exit 1; }
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
[[ -f "$SRC/pnpm-workspace.yaml" ]] || { echo "Run this from the extracted release folder."; exit 1; }
log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
rand() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }

if [[ "$SKIP_SYSTEM" != 1 ]]; then
  log "Installing system packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y curl ca-certificates gnupg nginx postgresql postgresql-contrib ufw cron
  if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]]; then
    log "Installing Node.js 22"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi
  systemctl enable --now postgresql
fi
corepack enable >/dev/null 2>&1 || npm install -g pnpm@10
id epc >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin epc
mkdir -p "$ETC" "$DATA/storage" "$DATA/backups"

log "Database"
if [[ -f "$ETC/env" ]]; then
  # shellcheck disable=SC1091
  source "$ETC/env"; echo "Keeping existing configuration in $ETC/env"
else
  DBPASS=$(rand 32); JWT_SECRET=$(rand 64)
  su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='$DBUSER'\"" | grep -q 1 || su postgres -c "psql -c \"CREATE ROLE $DBUSER LOGIN PASSWORD '$DBPASS'\""
  su postgres -c "psql -c \"ALTER ROLE $DBUSER PASSWORD '$DBPASS'\"" >/dev/null
  su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$DB'\"" | grep -q 1 || su postgres -c "createdb -O $DBUSER $DB"
  ORIGIN=$([[ -n "$DOMAIN" ]] && echo "https://$DOMAIN" || echo "")
  umask 077
  cat > "$ETC/env" <<ENV
NODE_ENV=production
HOST=127.0.0.1
PORT=$PORT
DATABASE_URL=postgresql://$DBUSER:$DBPASS@localhost:5432/$DB
JWT_SECRET=$JWT_SECRET
STORAGE_DIR=$DATA/storage
CORS_ORIGIN=$ORIGIN
ENV
  umask 022
  # shellcheck disable=SC1091
  source "$ETC/env"
fi
chown root:epc "$ETC/env"; chmod 640 "$ETC/env"

log "Copying application to $APP_DIR"
mkdir -p "$APP_DIR"
if [[ "$SRC" != "$APP_DIR" ]]; then
  tar -C "$SRC" --exclude=node_modules --exclude=.git --exclude=./apps/api/storage --exclude=./storage --exclude=./apps/api/storage-test --exclude='./apps/api/.env' --exclude='apps/web/dist' -cf - . | tar -C "$APP_DIR" -xf -
fi
chown -R epc:epc "$APP_DIR" "$DATA"

log "Installing dependencies and building (a few minutes)"
cd "$APP_DIR"
sudo -u epc -H --preserve-env=PATH,HTTPS_PROXY,HTTP_PROXY,NO_PROXY,https_proxy,http_proxy,no_proxy,NODE_EXTRA_CA_CERTS env HOME="$DATA" COREPACK_ENABLE_DOWNLOAD_PROMPT=0 bash -c "pnpm install --frozen-lockfile --prod=false && pnpm --filter @epc/api exec prisma generate && pnpm --filter @epc/web exec vite build"

log "Migrating database"
sudo -u epc -H --preserve-env=PATH,HTTPS_PROXY,HTTP_PROXY,NO_PROXY,https_proxy,http_proxy,no_proxy,NODE_EXTRA_CA_CERTS env HOME="$DATA" DATABASE_URL="$DATABASE_URL" bash -c "cd apps/api && npx prisma migrate deploy"

log "First administrator"
GENERATED=0
USERS=$(psql "$DATABASE_URL" -tAc 'SELECT count(*) FROM "User"' 2>/dev/null || echo 0)
if [[ "$USERS" -gt 0 ]]; then
  echo "Users already exist; the administrator was not changed."; ADMIN_EMAIL="(existing users)"
else
  if [[ -z "$ADMIN_EMAIL" ]]; then read -rp "Super administrator email: " ADMIN_EMAIL; fi
  if [[ -z "$ADMIN_PASSWORD" ]]; then ADMIN_PASSWORD="$(rand 14)"; GENERATED=1; fi
  sudo -u epc -H --preserve-env=PATH env HOME="$DATA" DATABASE_URL="$DATABASE_URL" SEED_ADMIN_EMAIL="$ADMIN_EMAIL" SEED_ADMIN_PASSWORD="$ADMIN_PASSWORD" SEED_COMPANY_NAME="$COMPANY" SEED_COMPANY_CODE="$COMPANY_CODE" bash -c "cd apps/api && npx tsx prisma/seed.ts"
fi

if [[ "$SKIP_SYSTEM" != 1 ]]; then
  log "Service"
  cat > /etc/systemd/system/epc-erp.service <<UNIT
[Unit]
Description=EPC Contracts & Billing
After=network.target postgresql.service
Requires=postgresql.service

[Service]
User=epc
Group=epc
WorkingDirectory=$APP_DIR/apps/api
EnvironmentFile=$ETC/env
ExecStart=/usr/bin/env node --import tsx src/server.ts
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable epc-erp
  systemctl restart epc-erp

  log "nginx"
  SERVER_NAME=${DOMAIN:-_}
  cat > /etc/nginx/sites-available/epc-erp <<NGINX
server {
    listen 80;
    server_name $SERVER_NAME;
    client_max_body_size 50m;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
NGINX
  ln -sf /etc/nginx/sites-available/epc-erp /etc/nginx/sites-enabled/epc-erp
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx

  if [[ -n "$DOMAIN" ]]; then
    log "HTTPS certificate for $DOMAIN"
    apt-get install -y certbot python3-certbot-nginx
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos ${LE_EMAIL:+-m "$LE_EMAIL"} ${LE_EMAIL:---register-unsafely-without-email} --redirect || echo "Certificate request failed: check that $DOMAIN points to this server, then run: certbot --nginx -d $DOMAIN"
  fi

  log "Firewall"
  ufw allow OpenSSH >/dev/null; ufw allow 'Nginx Full' >/dev/null; ufw --force enable >/dev/null || true

  log "Daily backups"
  install -m 755 "$APP_DIR/deploy/vps/backup.sh" /usr/local/bin/epc-erp-backup
  echo "30 2 * * * root /usr/local/bin/epc-erp-backup >> /var/log/epc-erp-backup.log 2>&1" > /etc/cron.d/epc-erp-backup
  install -m 755 "$APP_DIR/deploy/vps/update.sh" /usr/local/bin/epc-erp-update

  for i in $(seq 1 30); do curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null && break; sleep 1; done
  curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null && echo "Service is running." || { echo "Service did not start; see: journalctl -u epc-erp -n 50"; exit 1; }
fi

URL=$([[ -n "$DOMAIN" ]] && echo "https://$DOMAIN" || echo "http://$(curl -fs4 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')")
cat <<DONE

────────────────────────────────────────────────────────
 EPC Contracts & Billing is installed.
   Open:      $URL
   Sign in:   $ADMIN_EMAIL
DONE
[[ $GENERATED == 1 ]] && echo "   Password:  $ADMIN_PASSWORD   (shown once: change it after signing in)"
cat <<DONE
   Config:    $ETC/env        Files: $DATA/storage
   Backups:   $DATA/backups (daily 02:30, 14 kept)   Run now: epc-erp-backup
   Update:    extract a new release, then: sudo epc-erp-update /path/to/release
   Logs:      journalctl -u epc-erp -f
────────────────────────────────────────────────────────
DONE
