#!/usr/bin/env bash
set -euo pipefail
umask 077
export PATH=/opt/node-v22/bin:$PATH

ARCHIVE=${1:?Usage: api-release.sh ARCHIVE SHA256_FILE}
CHECKSUM=${2:?Usage: api-release.sh ARCHIVE SHA256_FILE}
BASE=/opt/ducmy/api
ENV_FILE=/etc/ducmy/api.env
BACKUP_DIR=/var/backups/ducmy
[[ -f "$ARCHIVE" && -f "$CHECKSUM" && -r "$ENV_FILE" && -x /opt/node-v22/bin/node ]] || { echo 'Archive, checksum, API environment, or Node 22 is missing.' >&2; exit 1; }
[[ "$(realpath -m "$(dirname "$ARCHIVE")")" == "$(realpath -m "$(dirname "$CHECKSUM")")" ]] || { echo 'Archive and checksum must be in the same directory.' >&2; exit 1; }
command -v restic >/dev/null && command -v mariadb-dump >/dev/null && command -v sha256sum >/dev/null
[[ -r /etc/ducmy/restic.env && -r /etc/ducmy/mariadb-backup.cnf ]] || { echo 'Backup configuration is missing.' >&2; exit 1; }
[[ $(stat -c %a "$ENV_FILE") =~ ^(600|640)$ ]] || { echo 'API environment permissions must be 600 or 640.' >&2; exit 1; }
cd "$(dirname "$ARCHIVE")"
[[ "$(basename "$CHECKSUM")" == "$(basename "$ARCHIVE").sha256" ]] || { echo 'Checksum filename does not match archive.' >&2; exit 1; }
[[ "$(awk 'NR==1 {print $2}' "$CHECKSUM")" == "$(basename "$ARCHIVE")" && "$(wc -l < "$CHECKSUM")" -eq 1 ]] || { echo 'Checksum does not name this archive.' >&2; exit 1; }
sha256sum -c "$(basename "$CHECKSUM")"
SHA=$(basename "$ARCHIVE" | sed -nE 's/^ducmy-api-([0-9a-f]{40})\.tar\.gz$/\1/p')
[[ -n "$SHA" ]] || { echo 'Archive must identify a 40-character commit SHA.' >&2; exit 1; }
exec 9>"$BASE/deploy.lock"
flock -n 9 || { echo 'Another API release is running.' >&2; exit 1; }
TARGET="$BASE/releases/$SHA"
[[ ! -e "$TARGET" ]] || { echo 'Release already exists; refusing overwrite.' >&2; exit 1; }
mkdir -p "$TARGET" "$BACKUP_DIR"
python3 "$BASE/manual/validate-archive.py" "$ARCHIVE" "$TARGET"
[[ -f "$TARGET/dist/server.js" && -x "$TARGET/node_modules/.bin/prisma" ]] || { echo 'Incomplete API artifact.' >&2; exit 1; }

set -a
# Operator-controlled, mode-600/640 files. Never print their values.
source /etc/ducmy/restic.env
source "$ENV_FILE"
set +a
[[ "${NODE_ENV:-}" == production && "${PORT:-}" == 5000 && "${DATABASE_URL:-}" == mysql://* ]] || { echo 'Invalid production API environment.' >&2; exit 1; }
[[ "${RESTIC_REPOSITORY:-}" =~ ^(s3:|sftp:|rest:https://|b2:|azure:|gs:|swift:|rclone:) ]] || { echo 'An off-VPS restic repository is required.' >&2; exit 1; }
/opt/node-v22/bin/node -e 'const u = new URL(process.env.DATABASE_URL); if (!(["127.0.0.1", "localhost"].includes(u.hostname) && u.pathname === "/ducmy_production")) { console.error("DATABASE_URL must target local ducmy_production."); process.exit(1); }' || exit 1
cd "$TARGET"
/opt/node-v22/bin/node --input-type=module -e 'await import("./dist/config/env.js")' >/dev/null || { echo 'API environment validation failed before migration.' >&2; exit 1; }
restic snapshots >/dev/null
BACKUP="$BACKUP_DIR/ducmy-$(date -u +%Y%m%dT%H%M%SZ).sql"
mariadb-dump --defaults-extra-file=/etc/ducmy/mariadb-backup.cnf --single-transaction --routines --triggers --events ducmy_production > "$BACKUP"
[[ -s "$BACKUP" ]] || { rm -f "$BACKUP"; echo 'Empty database backup.' >&2; exit 1; }
sha256sum "$BACKUP" > "$BACKUP.sha256"
restic backup "$BACKUP" "$BACKUP.sha256" --tag ducmy --tag predeploy >/dev/null

OLD=$(readlink "$BASE/current" || true)
if ! ./node_modules/.bin/prisma migrate deploy; then
  curl --fail --silent --show-error http://127.0.0.1:5000/ready >/dev/null || true
  echo 'Prisma migration failed; current application unchanged. Inspect database migration state and readiness before retrying.' >&2
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
