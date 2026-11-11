#!/usr/bin/env bash
set -euo pipefail
UNIT=${1:?Usage: backup-alert.sh SYSTEMD_UNIT}
[[ "$UNIT" == ducmy-backup.service || "$UNIT" == ducmy-backup-prune.service ]] || exit 1
logger -p user.err "Duc My backup failed: $UNIT"
[[ -r /etc/ducmy/backup-alert-url ]] || { echo 'Backup alert URL missing; inspect system journal.' >&2; exit 1; }
URL=$(cat /etc/ducmy/backup-alert-url)
[[ "$URL" == https://* ]] || exit 1
curl --fail --silent --show-error --max-time 10 -H 'Content-Type: application/json' --data '{"text":"Duc My database backup failed; inspect systemd journal."}' "$URL" >/dev/null
