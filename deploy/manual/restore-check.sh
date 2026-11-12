#!/usr/bin/env bash
set -euo pipefail
umask 077
FILE=${1:?Usage: restore-check.sh BACKUP.sql BACKUP.sql.sha256 TEST_DB}
CHECKSUM=${2:?Usage: restore-check.sh BACKUP.sql BACKUP.sql.sha256 TEST_DB}
DB=${3:?Usage: restore-check.sh BACKUP.sql BACKUP.sql.sha256 TEST_DB}
[[ "$DB" =~ ^ducmy_restore_[a-z0-9_]+$ && "$DB" != ducmy_production ]] || { echo 'Only a new ducmy_restore_* database is allowed.' >&2; exit 1; }
[[ "$FILE" == /var/backups/ducmy/ducmy-*.sql && "$CHECKSUM" == "$FILE.sha256" && -f "$FILE" ]] || { echo 'Invalid backup path.' >&2; exit 1; }
CNF=/etc/ducmy/mariadb-restore.cnf
[[ -r "$CNF" ]] || { echo 'Disposable-restore credentials missing.' >&2; exit 1; }
SHA=$(basename "$FILE" | sed -nE 's/^ducmy-([0-9a-f]{40})-[0-9]{8}T[0-9]{6}Z\.sql$/\1/p')
[[ -n "$SHA" ]] || { echo 'Invalid backup name.' >&2; exit 1; }
source "$(dirname "$0")/verify-backup-evidence.sh"
verify_backup_evidence "$SHA" "$FILE" false || { echo 'Backup copy evidence or checksum mismatch.' >&2; exit 1; }
[[ ! -e "$FILE.restore-proof" ]] || { echo 'Restore proof already exists; use a fresh backup.' >&2; exit 1; }
if mariadb --defaults-extra-file="$CNF" --batch --skip-column-names -e "SHOW DATABASES LIKE '$DB'" | grep -qx "$DB"; then
  echo 'Disposable target already exists; refusing overwrite.' >&2; exit 1
fi
mariadb --defaults-extra-file="$CNF" -e "CREATE DATABASE \`$DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
cleanup() { mariadb --defaults-extra-file="$CNF" -e "DROP DATABASE \`$DB\`"; }
trap cleanup EXIT
mariadb --defaults-extra-file="$CNF" "$DB" < "$FILE"
python3 "$(dirname "$0")/verify-restore.py" "$CNF" "$DB" "$FILE"
cleanup
trap - EXIT
mapfile -t manifest < "$FILE.manifest"
{
  printf '%s\n' "${manifest[0]}" "${manifest[1]}" "${manifest[2]}"
  printf 'database=%s\n' "$DB"
} > "$FILE.restore-proof"
echo 'Disposable restore and foreign-key checks passed; test database will be removed.'
