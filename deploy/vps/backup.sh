#!/usr/bin/env bash
# Daily backup: PostgreSQL dump + uploaded documents. Keeps the last 14 of each.
set -euo pipefail
source /etc/epc-erp/env
DEST=/var/lib/epc-erp/backups; TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "$DEST"
pg_dump "$DATABASE_URL" -Fc -f "$DEST/db-$TS.dump"
tar -C "$STORAGE_DIR" -czf "$DEST/files-$TS.tar.gz" .
ls -1t "$DEST"/db-*.dump | tail -n +15 | xargs -r rm -f
ls -1t "$DEST"/files-*.tar.gz | tail -n +15 | xargs -r rm -f
echo "$(date -Is) backup ok: db-$TS.dump files-$TS.tar.gz"
# Restore: pg_restore --clean --if-exists -d "$DATABASE_URL" db-<ts>.dump ; tar -C "$STORAGE_DIR" -xzf files-<ts>.tar.gz
