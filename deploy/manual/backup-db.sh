#!/usr/bin/env bash
set -euo pipefail
umask 077

SHA=${1:?Usage: backup-db.sh RELEASE_SHA}
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid release SHA.' >&2; exit 1; }
DIR=/var/backups/ducmy
CNF=/etc/ducmy/mariadb-backup.cnf
[[ -r "$CNF" ]] || { echo 'MariaDB backup credentials missing.' >&2; exit 1; }
command -v mariadb-dump >/dev/null
command -v mariadb >/dev/null
command -v sha256sum >/dev/null
command -v openssl >/dev/null
mkdir -p "$DIR"
[[ ! -L "$DIR" && $(stat -c %a "$DIR") == 700 ]] || { echo 'Backup directory must be private and not a symlink.' >&2; exit 1; }

# --single-transaction is consistent only for transactional tables.
NON_TRANSACTIONAL=$(mariadb --defaults-extra-file="$CNF" --batch --skip-column-names -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='ducmy_production' AND table_type='BASE TABLE' AND engine <> 'InnoDB'")
[[ "$NON_TRANSACTIONAL" == 0 ]] || { echo 'Non-InnoDB tables prevent a consistent online dump.' >&2; exit 1; }
TABLE_COUNT=$(mariadb --defaults-extra-file="$CNF" --batch --skip-column-names -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='ducmy_production' AND table_type='BASE TABLE'")
[[ "$TABLE_COUNT" =~ ^[0-9]+$ ]] || { echo 'Cannot count production tables.' >&2; exit 1; }
ESTIMATE=$(mariadb --defaults-extra-file="$CNF" --batch --skip-column-names -e "SELECT COALESCE(SUM(data_length+index_length),0) FROM information_schema.tables WHERE table_schema='ducmy_production'")
[[ "$ESTIMATE" =~ ^[0-9]+$ ]] || { echo 'Cannot estimate production database size.' >&2; exit 1; }
[[ "$TABLE_COUNT" -eq 0 || "$ESTIMATE" -gt 0 ]] || { echo 'Cannot estimate nonempty production database size.' >&2; exit 1; }
FREE=$(df -B1 --output=avail "$DIR" | tail -n 1 | tr -d ' ')
[[ "$FREE" =~ ^[0-9]+$ && "$FREE" -gt $((ESTIMATE * 2 + 1073741824)) ]] || { echo 'Insufficient free space for a bounded SQL dump.' >&2; exit 1; }

FILE="$DIR/ducmy-${SHA}-$(date -u +%Y%m%dT%H%M%SZ).sql"
[[ ! -e "$FILE" ]] || { echo 'Backup file already exists.' >&2; exit 1; }
cleanup() { rm -f -- "$FILE" "$FILE.sha256" "$FILE.manifest"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mariadb-dump --defaults-extra-file="$CNF" --single-transaction --quick --routines --triggers --events ducmy_production > "$FILE"
[[ -s "$FILE" ]] || { echo 'Empty database dump.' >&2; exit 1; }
TABLE_COUNT_AFTER=$(mariadb --defaults-extra-file="$CNF" --batch --skip-column-names -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='ducmy_production' AND table_type='BASE TABLE'")
[[ "$TABLE_COUNT_AFTER" == "$TABLE_COUNT" ]] || { echo 'Production table count changed during dump.' >&2; exit 1; }
DUMP_TABLE_COUNT=$(grep -c '^CREATE TABLE ' "$FILE" || true)
[[ "$DUMP_TABLE_COUNT" == "$TABLE_COUNT" ]] || { echo 'SQL dump table count differs from production source.' >&2; exit 1; }
printf '\n-- appglv-source-tables=%s\n' "$TABLE_COUNT" >> "$FILE"
cd "$DIR"
sha256sum "$(basename "$FILE")" > "$FILE.sha256"
HASH=$(sha256sum "$FILE" | cut -d ' ' -f 1)
CHALLENGE=$(openssl rand -hex 32)
{
  printf 'release_sha=%s\n' "$SHA"
  printf 'backup_sha256=%s\n' "$HASH"
  printf 'challenge=%s\n' "$CHALLENGE"
  printf 'created_unix=%s\n' "$(date -u +%s)"
} > "$FILE.manifest"
trap - EXIT INT TERM
printf '%s\n' "$(basename "$FILE")"
