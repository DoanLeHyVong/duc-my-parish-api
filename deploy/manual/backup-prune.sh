#!/usr/bin/env bash
set -euo pipefail
source /etc/ducmy/restic.env
restic forget --tag ducmy --keep-within 30d --keep-monthly 6 --prune
