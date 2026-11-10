#!/usr/bin/env sh
set -eu

ENV_FILE="${1:?Usage: deploy.sh /path/to/.env.staging or .env.production}"
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

case "${DEPLOY_ENVIRONMENT:-}" in
  staging|production) ;;
  *) printf 'DEPLOY_ENVIRONMENT must be staging or production.\n' >&2; exit 1 ;;
esac

: "${GHCR_USER:?GHCR_USER is required for the private image registry}"
: "${GHCR_TOKEN_FILE:?GHCR_TOKEN_FILE is required for the private image registry}"
[ -r "$GHCR_TOKEN_FILE" ]
docker login ghcr.io --username "$GHCR_USER" --password-stdin < "$GHCR_TOKEN_FILE"

API_IMAGE="${REQUESTED_API_IMAGE:-${API_IMAGE:-}}"
WEB_IMAGE="${REQUESTED_WEB_IMAGE:-${WEB_IMAGE:-}}"
: "${API_IMAGE:?API_IMAGE is required in the environment or deployment env file}"
: "${WEB_IMAGE:?WEB_IMAGE is required in the environment or deployment env file}"
export API_IMAGE WEB_IMAGE

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

if [ -n "$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q db 2>/dev/null)" ]; then
  BACKUP_DIR="${BACKUP_DIR:-/var/backups/ducmy}" COMPOSE_FILE="$COMPOSE_FILE" "$SCRIPT_DIR/backup-db.sh" "$ENV_FILE"
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull api web
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --wait --remove-orphans
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

API_CONTAINER="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q api)"
WEB_CONTAINER="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q web)"
[ "$(docker inspect --format '{{.Config.Image}}' "$API_CONTAINER")" = "$API_IMAGE" ]
[ "$(docker inspect --format '{{.Config.Image}}' "$WEB_CONTAINER")" = "$WEB_IMAGE" ]
