#!/usr/bin/env sh
set -eu

ENV_FILE="${1:?Usage: backup-offsite.sh /path/to/.env.production}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$SCRIPT_DIR/../docker-compose.yml}"
command -v flock >/dev/null 2>&1 || { printf 'flock is required.\n' >&2; exit 1; }
exec 9>"${ENV_FILE}.lock"
flock 9
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
[ "${DEPLOY_ENVIRONMENT:-}" = production ] || { printf 'Only production backup is supported.\n' >&2; exit 1; }
: "${RESTIC_REPOSITORY:?Off-VPS RESTIC_REPOSITORY is required}"
case "$RESTIC_REPOSITORY" in
  s3:*|b2:*|rest:*|sftp:*|rclone:*|azure:*|gs:*|swift:*) ;;
  *) printf 'RESTIC_REPOSITORY must target an off-VPS backend.\n' >&2; exit 1 ;;
esac
: "${RESTIC_PASSWORD_FILE:?RESTIC_PASSWORD_FILE is required}"
[ -r "$RESTIC_PASSWORD_FILE" ]
command -v restic >/dev/null 2>&1
restic snapshots --latest 1 >/dev/null
BACKUP_FILE="$(BACKUP_DIR="${BACKUP_DIR:-/var/backups/ducmy}" COMPOSE_FILE="$COMPOSE_FILE" "$SCRIPT_DIR/backup-db.sh" "$ENV_FILE")"
restic backup "$BACKUP_FILE" "$BACKUP_FILE.sha256" --tag ducmy --tag scheduled >/dev/null
find "${BACKUP_DIR:-/var/backups/ducmy}" -maxdepth 1 -type f -name 'ducmy-*.sql' -mmin +2880 -delete
find "${BACKUP_DIR:-/var/backups/ducmy}" -maxdepth 1 -type f -name 'ducmy-*.sql.sha256' -mmin +2880 -delete
if [ "${PRUNE_BACKUPS:-false}" = true ]; then
  restic forget --tag ducmy --keep-within 30d --keep-monthly 6 --prune >/dev/null
fi
printf 'Off-VPS backup completed.\n'
