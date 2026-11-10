#!/usr/bin/env sh
set -eu

ENV_FILE="${1:?Usage: rollback.sh /path/to/compose-env-file API_IMAGE WEB_IMAGE}"
API_IMAGE="${2:?Previous API_IMAGE is required}"
WEB_IMAGE="${3:?Previous WEB_IMAGE is required}"
COMPOSE_FILE="${COMPOSE_FILE:-$(dirname "$0")/../docker-compose.yml}"

export API_IMAGE WEB_IMAGE
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d api web
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
printf 'Application rollback requested. Database migrations are not rolled back automatically.\n'
