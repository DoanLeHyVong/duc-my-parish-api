#!/usr/bin/env bash
set -euo pipefail
umask 077
DIR=/var/backups/ducmy
BASE=/opt/ducmy/api
[[ -d "$DIR" && ! -L "$DIR" ]] || exit 0
exec 9>"$BASE/deploy.lock"
flock -n 9 || { echo 'Release in progress; pruning skipped.' >&2; exit 1; }
NOW=$(date -u +%s)
shopt -s nullglob
for file in "$DIR"/ducmy-*.sql; do
  [[ ! -L "$file" && $(basename "$file") =~ ^ducmy-[0-9a-f]{40}-[0-9]{8}T[0-9]{6}Z\.sql$ ]] || continue
  AGE=$((NOW - $(stat -c %Y "$file")))
  # A prepared backup expires after 24h; keep it for up to 48h to diagnose failure.
  if [[ "$AGE" -gt 172800 ]]; then
    rm -f -- "$file" "$file.sha256" "$file.manifest" "$file.copy-receipt" "$file.restore-proof" "$file.used"
  fi
done
