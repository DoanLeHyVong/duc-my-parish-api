#!/usr/bin/env sh
set -eu

ENV_FILE="${1:?Usage: backup-db.sh /path/to/compose-env-file}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/ducmy}"
COMPOSE_FILE="${COMPOSE_FILE:-$(dirname "$0")/../docker-compose.yml}"
mkdir -p "$BACKUP_DIR"
umask 077
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT="$BACKUP_DIR/ducmy-$STAMP.sql"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db sh -c 'mariadb-dump --single-transaction --routines --triggers -uroot -p"$MARIADB_ROOT_PASSWORD" "$MARIADB_DATABASE"' > "$OUTPUT"
sha256sum "$OUTPUT" > "$OUTPUT.sha256"
printf 'Backup created outside the repository: %s\n' "$OUTPUT"
