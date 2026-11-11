#!/usr/bin/env sh
set -eu

ENV_FILE="${1:?Usage: deploy.sh /path/to/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$(dirname "$0")/../docker-compose.yml}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
REQUESTED_API_IMAGE="${API_IMAGE:-}"
REQUESTED_WEB_IMAGE="${WEB_IMAGE:-}"

if ! command -v flock >/dev/null 2>&1; then
  printf 'flock is required to serialize shared Compose deployments.\n' >&2
  exit 1
fi

exec 9>"${ENV_FILE}.lock"
flock 9

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

[ "${DEPLOY_ENVIRONMENT:-}" = production ] || { printf 'Only the approved production Compose environment is supported.\n' >&2; exit 1; }

: "${RESTIC_REPOSITORY:?Off-VPS RESTIC_REPOSITORY is required}"
case "$RESTIC_REPOSITORY" in
  s3:*|b2:*|rest:*|sftp:*|rclone:*|azure:*|gs:*|swift:*) ;;
  *) printf 'RESTIC_REPOSITORY must target an off-VPS backend.\n' >&2; exit 1 ;;
esac
: "${RESTIC_PASSWORD_FILE:?RESTIC_PASSWORD_FILE is required}"
[ -r "$RESTIC_PASSWORD_FILE" ] || { printf 'Off-VPS backup password file is unreadable.\n' >&2; exit 1; }
command -v restic >/dev/null 2>&1 || { printf 'restic is required for off-VPS backup.\n' >&2; exit 1; }
restic snapshots --latest 1 >/dev/null

: "${GHCR_USER:?GHCR_USER is required for the private image registry}"
: "${GHCR_TOKEN_FILE:?GHCR_TOKEN_FILE is required for the private image registry}"
[ -r "$GHCR_TOKEN_FILE" ]
docker login ghcr.io --username "$GHCR_USER" --password-stdin < "$GHCR_TOKEN_FILE"

API_IMAGE="${REQUESTED_API_IMAGE:-${API_IMAGE:-}}"
WEB_IMAGE="${REQUESTED_WEB_IMAGE:-${WEB_IMAGE:-}}"
: "${API_IMAGE:?API_IMAGE is required in the environment or deployment env file}"
: "${WEB_IMAGE:?WEB_IMAGE is required in the environment or deployment env file}"
export API_IMAGE WEB_IMAGE

DB_CONTAINER="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -a -q db 2>/dev/null)"
if [ -n "$DB_CONTAINER" ] || docker volume inspect "${COMPOSE_PROJECT_NAME:?COMPOSE_PROJECT_NAME is required}_db_data" >/dev/null 2>&1; then
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --wait db
  BACKUP_FILE="$(BACKUP_DIR="${BACKUP_DIR:-/var/backups/ducmy}" COMPOSE_FILE="$COMPOSE_FILE" "$SCRIPT_DIR/backup-db.sh" "$ENV_FILE")"
  restic backup "$BACKUP_FILE" "$BACKUP_FILE.sha256" --tag ducmy --tag predeploy >/dev/null
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull api web
if [ -n "${DEPLOY_CONFIG_SOURCE:-}" ]; then
  [ -f "$DEPLOY_CONFIG_SOURCE/docker-compose.yml" ] || { printf 'Deployment bundle is incomplete.\n' >&2; exit 1; }
  [ -f "$DEPLOY_CONFIG_SOURCE/scripts/deploy.sh" ] || { printf 'Deployment scripts are incomplete.\n' >&2; exit 1; }
  cp -p "$DEPLOY_CONFIG_SOURCE/docker-compose.yml" "$COMPOSE_FILE.tmp.$$"
  mv "$COMPOSE_FILE.tmp.$$" "$COMPOSE_FILE"
  mkdir -p "$(dirname "$COMPOSE_FILE")/scripts"
  cp -p "$DEPLOY_CONFIG_SOURCE"/scripts/* "$(dirname "$COMPOSE_FILE")/scripts/"
fi
TEMP_ENV_FILE="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
trap 'rm -f "$TEMP_ENV_FILE"' EXIT
awk -v api_image="$API_IMAGE" -v web_image="$WEB_IMAGE" '
  /^API_IMAGE=/ { print "API_IMAGE=" api_image; api_seen=1; next }
  /^WEB_IMAGE=/ { print "WEB_IMAGE=" web_image; web_seen=1; next }
  { print }
  END {
    if (!api_seen) print "API_IMAGE=" api_image
    if (!web_seen) print "WEB_IMAGE=" web_image
  }
' "$ENV_FILE" > "$TEMP_ENV_FILE"
chmod --reference="$ENV_FILE" "$TEMP_ENV_FILE" 2>/dev/null || true
mv "$TEMP_ENV_FILE" "$ENV_FILE"
trap - EXIT
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --wait --remove-orphans
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

API_CONTAINER="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q api)"
WEB_CONTAINER="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q web)"
[ "$(docker inspect --format '{{.Config.Image}}' "$API_CONTAINER")" = "$API_IMAGE" ]
[ "$(docker inspect --format '{{.Config.Image}}' "$WEB_CONTAINER")" = "$WEB_IMAGE" ]
API_URL="${PUBLIC_API_URL:?PUBLIC_API_URL is required}" EXPECTED_API_URL="${PUBLIC_API_URL}/api/v1" WEB_URL="${PUBLIC_WEB_URL:?PUBLIC_WEB_URL is required}" "$SCRIPT_DIR/smoke.sh"
