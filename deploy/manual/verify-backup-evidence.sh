#!/usr/bin/env bash
# Source this file, then call verify_backup_evidence SHA BACKUP [require_restore] [directory].
verify_backup_evidence() {
  local sha=$1 backup=$2 require_restore=${3:-true} dir=${4:-/var/backups/ducmy}
  local name hash challenge created now
  local -a manifest file
  name=$(basename -- "$backup")
  [[ "$sha" =~ ^[0-9a-f]{40}$ && "$name" =~ ^ducmy-${sha}-[0-9]{8}T[0-9]{6}Z\.sql$ ]] || return 1
  [[ "$backup" == "$dir/$name" && -s "$backup" && ! -L "$backup" && ! -L "$backup.manifest" ]] || return 1
  [[ -f "$backup.sha256" && -f "$backup.manifest" ]] || return 1
  mapfile -t manifest < "$backup.manifest"
  [[ ${#manifest[@]} -eq 4 && ${manifest[0]} == "release_sha=$sha" && ${manifest[1]} =~ ^backup_sha256=([0-9a-f]{64})$ ]] || return 1
  hash=${BASH_REMATCH[1]}
  [[ ${manifest[2]} =~ ^challenge=([0-9a-f]{64})$ ]] || return 1
  challenge=${BASH_REMATCH[1]}
  [[ ${manifest[3]} =~ ^created_unix=([0-9]+)$ ]] || return 1
  created=${BASH_REMATCH[1]}
  now=$(date -u +%s)
  [[ "$created" -le "$now" && $((now - created)) -le 86400 ]] || return 1
  [[ $(cat "$backup.sha256") == "$hash  $name" ]] || return 1
  (cd "$dir" && sha256sum -c --status "$name.sha256") || return 1
  [[ -f "$backup.copy-receipt" && ! -L "$backup.copy-receipt" ]] || return 1
  mapfile -t file < "$backup.copy-receipt"
  [[ ${#file[@]} -eq 3 && ${file[0]} == "release_sha=$sha" && ${file[1]} == "backup_sha256=$hash" && ${file[2]} == "challenge=$challenge" ]] || return 1
  if [[ "$require_restore" == true ]]; then
    [[ -f "$backup.restore-proof" && ! -L "$backup.restore-proof" ]] || return 1
    mapfile -t file < "$backup.restore-proof"
    [[ ${#file[@]} -eq 4 && ${file[0]} == "release_sha=$sha" && ${file[1]} == "backup_sha256=$hash" && ${file[2]} == "challenge=$challenge" && ${file[3]} =~ ^database=ducmy_restore_[a-z0-9_]+$ ]] || return 1
  fi
}
