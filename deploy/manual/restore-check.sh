#!/usr/bin/env bash
set -euo pipefail
FILE=${1:?Usage: restore-check.sh BACKUP.sql BACKUP.sql.sha256 TEST_DB}
CHECKSUM=${2:?Usage: restore-check.sh BACKUP.sql BACKUP.sql.sha256 TEST_DB}
DB=${3:?Usage: restore-check.sh BACKUP.sql BACKUP.sql.sha256 TEST_DB}
[[ "$DB" =~ ^ducmy_restore_[a-z0-9_]+$ ]] || { echo 'Only a disposable ducmy_restore_* database is allowed.' >&2; exit 1; }
cd "$(dirname "$FILE")"
sha256sum -c "$(basename "$CHECKSUM")"
[[ -r /etc/ducmy/mariadb-restore.cnf ]] || { echo 'Disposable-restore operator credentials missing.' >&2; exit 1; }
if mariadb --defaults-extra-file=/etc/ducmy/mariadb-restore.cnf --batch --skip-column-names -e "SHOW DATABASES LIKE '$DB'" | grep -qx "$DB"; then
  echo 'Disposable target already exists; refusing overwrite.' >&2; exit 1
fi
mariadb --defaults-extra-file=/etc/ducmy/mariadb-restore.cnf -e "CREATE DATABASE \`$DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
mariadb --defaults-extra-file=/etc/ducmy/mariadb-restore.cnf "$DB" < "$FILE"
TABLES=$(mariadb --defaults-extra-file=/etc/ducmy/mariadb-restore.cnf --batch --skip-column-names -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DB'")
[[ "$TABLES" =~ ^[0-9]+$ && "$TABLES" -gt 0 ]] || { echo 'Restore has no tables.' >&2; exit 1; }
echo "Disposable restore complete: $DB, tables=$TABLES. Validate application data and foreign keys before accepting backup readiness."
