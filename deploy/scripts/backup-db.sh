#!/usr/bin/env sh
set -eu

ENV_FILE="${1:?Usage: backup-db.sh /path/to/compose-env-file}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/ducmy}"
COMPOSE_FILE="${COMPOSE_FILE:-$(dirname "$0")/../docker-compose.yml}"
mkdir -p "$BACKUP_DIR"
umask 077
BACKUP_DIR_REAL="$(CDPATH= cd -- "$BACKUP_DIR" && pwd)"
DEPLOY_ROOT="$(CDPATH= cd -- "$(dirname "$COMPOSE_FILE")/.." && pwd)"
case "$BACKUP_DIR_REAL" in
  "$DEPLOY_ROOT"|"$DEPLOY_ROOT"/*)
    printf 'BACKUP_DIR must be outside the deployment directory.\n' >&2
    exit 1
    ;;
esac
chmod 700 "$BACKUP_DIR_REAL"
TEMP_OUTPUT="$(mktemp "$BACKUP_DIR/ducmy-XXXXXX.sql")"
trap 'rm -f "$TEMP_OUTPUT"' EXIT

if ! docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db sh -c 'mariadb-dump --single-transaction --routines --triggers -uroot -p"$MARIADB_ROOT_PASSWORD" "$MARIADB_DATABASE"' > "$TEMP_OUTPUT"; then
  printf 'Database backup failed; partial output was removed.\n' >&2
  exit 1
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT="$BACKUP_DIR/ducmy-$STAMP-$$.sql"
mv "$TEMP_OUTPUT" "$OUTPUT"
trap - EXIT
sha256sum "$OUTPUT" > "$OUTPUT.sha256"
printf 'Backup created outside the repository: %s\n' "$OUTPUT"
