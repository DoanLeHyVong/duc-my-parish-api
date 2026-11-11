#!/usr/bin/env bash
set -euo pipefail
umask 077
source /etc/ducmy/restic.env
DIR=/var/backups/ducmy
mkdir -p "$DIR"
FILE="$DIR/ducmy-$(date -u +%Y%m%dT%H%M%SZ).sql"
trap 'rm -f "$FILE" "$FILE.sha256"' ERR
mariadb-dump --defaults-extra-file=/etc/ducmy/mariadb-backup.cnf --single-transaction --routines --triggers --events ducmy_production > "$FILE"
test -s "$FILE"
sha256sum "$FILE" > "$FILE.sha256"
restic backup "$FILE" "$FILE.sha256" --tag ducmy --tag scheduled >/dev/null
find "$DIR" -maxdepth 1 -type f -name 'ducmy-*.sql' -mmin +2880 -delete
find "$DIR" -maxdepth 1 -type f -name 'ducmy-*.sql.sha256' -mmin +2880 -delete
echo 'Off-VPS database backup completed.'
