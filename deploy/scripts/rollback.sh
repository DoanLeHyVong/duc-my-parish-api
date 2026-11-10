#!/usr/bin/env sh
set -eu

ENV_FILE="${1:?Usage: rollback.sh /path/to/compose-env-file API_IMAGE WEB_IMAGE}"
API_IMAGE="${2:?Previous API_IMAGE is required}"
WEB_IMAGE="${3:?Previous WEB_IMAGE is required}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"

API_IMAGE="$API_IMAGE" WEB_IMAGE="$WEB_IMAGE" "$SCRIPT_DIR/deploy.sh" "$ENV_FILE"
if [ -n "${API_URL:-}" ] && [ -n "${WEB_URL:-}" ] && [ -n "${EXPECTED_API_URL:-}" ]; then
  "$SCRIPT_DIR/smoke.sh"
fi
printf 'Application rollback requested. Database migrations are not rolled back automatically.\n'
