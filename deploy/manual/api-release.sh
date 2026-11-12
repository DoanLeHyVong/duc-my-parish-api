#!/usr/bin/env bash
set -euo pipefail
umask 077
export PATH=/opt/node-v22/bin:$PATH

MODE=${1:?Usage: api-release.sh --prepare|--release ARCHIVE SHA256_FILE}
ARCHIVE=${2:?Usage: api-release.sh --prepare|--release ARCHIVE SHA256_FILE}
CHECKSUM=${3:?Usage: api-release.sh --prepare|--release ARCHIVE SHA256_FILE}
[[ "$MODE" == --prepare || "$MODE" == --release ]] || { echo 'Choose --prepare or --release.' >&2; exit 1; }
BASE=/opt/ducmy/api
ENV_FILE=/etc/ducmy/api.env
BACKUP_DIR=/var/backups/ducmy
[[ -f "$ARCHIVE" && -f "$CHECKSUM" && -r "$ENV_FILE" && -x /opt/node-v22/bin/node ]] || { echo 'Archive, checksum, API environment, or Node 22 is missing.' >&2; exit 1; }
[[ ! -L "$ARCHIVE" && ! -L "$CHECKSUM" && $(realpath -m "$(dirname "$ARCHIVE")") == "$(realpath -m "$(dirname "$CHECKSUM")")" ]] || { echo 'Archive and checksum must share a real directory.' >&2; exit 1; }
ARCHIVE=$(realpath "$ARCHIVE")
CHECKSUM=$(realpath "$CHECKSUM")
command -v sha256sum >/dev/null
[[ $(stat -c %a "$ENV_FILE") =~ ^(600|640)$ ]] || { echo 'API environment permissions must be 600 or 640.' >&2; exit 1; }
cd "$(dirname "$ARCHIVE")"
[[ $(basename "$CHECKSUM") == "$(basename "$ARCHIVE").sha256" ]] || { echo 'Checksum filename does not match archive.' >&2; exit 1; }
[[ $(awk 'NR==1 {print $2}' "$CHECKSUM") == "$(basename "$ARCHIVE")" && $(wc -l < "$CHECKSUM") -eq 1 ]] || { echo 'Checksum does not name this archive.' >&2; exit 1; }
sha256sum -c "$(basename "$CHECKSUM")"
SHA=$(basename "$ARCHIVE" | sed -nE 's/^ducmy-api-([0-9a-f]{40})\.tar\.gz$/\1/p')
[[ -n "$SHA" ]] || { echo 'Archive must identify a 40-character commit SHA.' >&2; exit 1; }
exec 9>"$BASE/deploy.lock"
flock -n 9 || { echo 'Another API release is running.' >&2; exit 1; }
TARGET="$BASE/releases/$SHA"
STATE="$BASE/prepared-$SHA.backup-name"
ARTIFACT_HASH=$(sha256sum "$ARCHIVE" | cut -d ' ' -f 1)

set -a
source "$ENV_FILE"
set +a
[[ "${NODE_ENV:-}" == production && "${PORT:-}" == 5000 && "${DATABASE_URL:-}" == mysql://* ]] || { echo 'Invalid production API environment.' >&2; exit 1; }
/opt/node-v22/bin/node -e 'const u = new URL(process.env.DATABASE_URL); if (!(u.hostname === "127.0.0.1" && u.port === "3306" && u.pathname === "/ducmy_production")) { console.error("DATABASE_URL must target local ducmy_production on port 3306."); process.exit(1); }'

if [[ "$MODE" == --prepare ]]; then
  [[ -r /etc/ducmy/mariadb-backup.cnf ]] || { echo 'Backup identity missing.' >&2; exit 1; }
  if [[ -e "$TARGET" || -e "$STATE" ]]; then
    [[ -d "$TARGET" && -f "$STATE" && ! -L "$STATE" && $(readlink "$BASE/current" || true) != "releases/$SHA" ]] || { echo 'Release target is active or inconsistent; refusing prepare.' >&2; exit 1; }
    OLD_NAME=$(cat "$STATE")
    [[ "$OLD_NAME" =~ ^ducmy-${SHA}-[0-9]{8}T[0-9]{6}Z\.sql$ ]] || { echo 'Invalid previous preparation state.' >&2; exit 1; }
    OLD_BACKUP="$BACKUP_DIR/$OLD_NAME"
    if [[ -f "$OLD_BACKUP" && ! -f "$OLD_BACKUP.used" && $(( $(date -u +%s) - $(stat -c %Y "$OLD_BACKUP") )) -le 86400 ]]; then
      echo 'Previous fresh backup has not been consumed; finish it before preparing again.' >&2; exit 1
    fi
    [[ -f "$TARGET/.source-archive.sha256" && $(cat "$TARGET/.source-archive.sha256") == "$ARTIFACT_HASH" ]] || { echo 'Prepared release artifact differs; refusing retry.' >&2; exit 1; }
  else
    mkdir -p "$TARGET"
    python3 "$BASE/manual/validate-archive.py" "$ARCHIVE" "$TARGET"
    printf '%s\n' "$ARTIFACT_HASH" > "$TARGET/.source-archive.sha256"
  fi
  [[ -f "$TARGET/dist/server.js" && -x "$TARGET/node_modules/.bin/prisma" ]] || { echo 'Incomplete API artifact.' >&2; exit 1; }
  cd "$TARGET"
  /opt/node-v22/bin/node --input-type=module -e 'await import("./dist/config/env.js")' >/dev/null || { echo 'API environment validation failed.' >&2; exit 1; }
  NAME=$(/opt/ducmy/api/manual/backup-db.sh "$SHA")
  printf '%s\n' "$NAME" > "$STATE"
  echo "Backup prepared: $NAME"
  echo 'Download and verify on Windows, run restore-check.sh, then invoke --release.'
  exit 0
fi

[[ -d "$TARGET" && -f "$TARGET/dist/server.js" && -f "$STATE" && ! -L "$STATE" ]] || { echo 'Prepare phase is missing.' >&2; exit 1; }
[[ -f "$TARGET/.source-archive.sha256" && $(cat "$TARGET/.source-archive.sha256") == "$ARTIFACT_HASH" ]] || { echo 'Prepared artifact checksum differs.' >&2; exit 1; }
python3 "$BASE/manual/verify-release-tree.py" "$ARCHIVE" "$TARGET" || { echo 'Prepared release tree changed after archive verification.' >&2; exit 1; }
NAME=$(cat "$STATE")
[[ "$NAME" =~ ^ducmy-${SHA}-[0-9]{8}T[0-9]{6}Z\.sql$ ]] || { echo 'Invalid prepared backup state.' >&2; exit 1; }
BACKUP="$BACKUP_DIR/$NAME"
[[ ! -e "$BACKUP.used" ]] || { echo 'Backup evidence was already consumed.' >&2; exit 1; }
source "$BASE/manual/verify-backup-evidence.sh"
verify_backup_evidence "$SHA" "$BACKUP" true || { echo 'No matching verified Windows copy and disposable restore; migration refused.' >&2; exit 1; }
cd "$TARGET"
/opt/node-v22/bin/node --input-type=module -e 'await import("./dist/config/env.js")' >/dev/null || { echo 'API environment validation failed before migration.' >&2; exit 1; }
# Consume evidence before the irreversible migration, including if migration fails.
printf '%s\n' "$(date -u +%s)" > "$BACKUP.used"
OLD=$(readlink "$BASE/current" || true)
if ! ./node_modules/.bin/prisma migrate deploy; then
  echo 'Prisma migration failed; current application unchanged. Inspect migration state before any retry.' >&2
  exit 1
fi
ln -sfn "releases/$SHA" "$BASE/current.next"
mv -Tf "$BASE/current.next" "$BASE/current"
if ! sudo systemctl restart ducmy-api || ! curl --fail --silent --show-error --retry 8 --retry-delay 2 http://127.0.0.1:5000/ready >/dev/null; then
  if [[ -n "$OLD" ]]; then
    ln -sfn "$OLD" "$BASE/current.next"
    mv -Tf "$BASE/current.next" "$BASE/current"
    sudo systemctl restart ducmy-api
  else
    rm -f "$BASE/current"
  fi
  echo 'API failed readiness. Application link restored if possible. Database migrations were NOT reverted.' >&2
  exit 1
fi
echo "API release active: $SHA"
