#!/usr/bin/env bash
set -euo pipefail
BASE=/opt/ducmy/api
SHA=${1:?Usage: api-rollback.sh PREVIOUS_COMMIT_SHA}
[[ "$SHA" =~ ^[0-9a-f]{40}$ && -f "$BASE/releases/$SHA/dist/server.js" ]] || { echo 'Unknown release.' >&2; exit 1; }
exec 9>"$BASE/deploy.lock"
flock -n 9 || exit 1
OLD=$(readlink "$BASE/current" || true)
ln -sfn "releases/$SHA" "$BASE/current.next"
mv -Tf "$BASE/current.next" "$BASE/current"
if ! sudo systemctl restart ducmy-api || ! curl --fail --silent --show-error --retry 8 --retry-delay 2 http://127.0.0.1:5000/ready >/dev/null; then
  if [[ -n "$OLD" ]]; then ln -sfn "$OLD" "$BASE/current.next"; mv -Tf "$BASE/current.next" "$BASE/current"; sudo systemctl restart ducmy-api; fi
  echo 'Rollback failed. Database schema is unchanged; check migration compatibility.' >&2
  exit 1
fi
echo "API release active: $SHA (database unchanged)"
