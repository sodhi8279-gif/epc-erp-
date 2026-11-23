#!/usr/bin/env bash
# Update to a new release: sudo epc-erp-update /path/to/extracted/release
# Takes a backup first, then copies, builds, migrates and restarts. Data and configuration are untouched.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root (sudo)."; exit 1; }
SRC="${1:?Usage: epc-erp-update /path/to/extracted/release}"
APP_DIR=/opt/epc-erp
[[ -f "$SRC/pnpm-workspace.yaml" ]] || { echo "$SRC is not a release folder"; exit 1; }
source /etc/epc-erp/env
/usr/local/bin/epc-erp-backup
systemctl stop epc-erp
tar -C "$SRC" --exclude=node_modules --exclude=.git --exclude=./apps/api/storage --exclude=./storage --exclude=./apps/api/storage-test --exclude='./apps/api/.env' --exclude='apps/web/dist' -cf - . | tar -C "$APP_DIR" -xf -
chown -R epc:epc "$APP_DIR"
cd "$APP_DIR"
sudo -u epc -H --preserve-env=PATH,HTTPS_PROXY,HTTP_PROXY,NO_PROXY,https_proxy,http_proxy,no_proxy,NODE_EXTRA_CA_CERTS env HOME=/var/lib/epc-erp COREPACK_ENABLE_DOWNLOAD_PROMPT=0 bash -c "pnpm install --frozen-lockfile --prod=false && pnpm --filter @epc/api exec prisma generate && pnpm --filter @epc/web exec vite build"
sudo -u epc -H --preserve-env=PATH,HTTPS_PROXY,HTTP_PROXY,NO_PROXY,https_proxy,http_proxy,no_proxy,NODE_EXTRA_CA_CERTS env HOME=/var/lib/epc-erp DATABASE_URL="$DATABASE_URL" bash -c "cd apps/api && npx prisma migrate deploy"
install -m 755 deploy/vps/backup.sh /usr/local/bin/epc-erp-backup
install -m 755 deploy/vps/update.sh /usr/local/bin/epc-erp-update
systemctl start epc-erp
for i in $(seq 1 30); do curl -fs "http://127.0.0.1:${PORT:-4000}/api/health" >/dev/null && { echo "Updated and running."; exit 0; }; sleep 1; done
echo "Service did not come back; see journalctl -u epc-erp -n 50"; exit 1
