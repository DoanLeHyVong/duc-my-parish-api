#!/usr/bin/env sh
set -eu

JOB="${1:?Failed systemd unit name is required}"
case "$JOB" in
  ducmy-backup.service|ducmy-backup-prune.service) ;;
  *) printf 'Unexpected backup unit.\n' >&2; exit 1 ;;
esac
: "${ALERT_WEBHOOK_FILE:?ALERT_WEBHOOK_FILE is required}"
[ -r "$ALERT_WEBHOOK_FILE" ] || { printf 'Backup alert webhook is not configured.\n' >&2; exit 1; }
IFS= read -r ALERT_WEBHOOK_URL < "$ALERT_WEBHOOK_FILE"
case "$ALERT_WEBHOOK_URL" in
  https://*) ;;
  *) printf 'Backup alert webhook must use HTTPS.\n' >&2; exit 1 ;;
esac
curl --fail --silent --show-error --max-time 15 --request POST \
  --header 'Content-Type: application/json' \
  --data "{\"text\":\"Duc My backup failed: $JOB\"}" \
  "$ALERT_WEBHOOK_URL" >/dev/null
