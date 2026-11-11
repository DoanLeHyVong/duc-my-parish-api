#!/usr/bin/env bash
set -euo pipefail
source /etc/ducmy/restic.env
[[ "${RESTIC_REPOSITORY:-}" =~ ^(s3:|sftp:|rest:https://|b2:|azure:|gs:|swift:|rclone:) ]] || { echo 'An off-VPS restic repository is required.' >&2; exit 1; }
restic forget --tag ducmy --group-by host --keep-within 30d --keep-monthly 6 --prune
