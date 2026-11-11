# Native Ubuntu runtime (manual release only)

This directory supersedes `deploy/docker-compose.yml` for the owner's 1 GB VPS. The Compose files remain as historical rollback references; no workflow invokes them. Use `D:\AppGLV\_bmad-output\implementation-artifacts\ducmy-manual-vps-deployment-guide.md` for first installation, privilege setup, backup restore and release commands.

`main` CI produces a Linux x64 archive containing compiled `dist`, Prisma migrations/CLI and Node dependencies. Download it on Windows, verify SHA-256, then use `windows/Send-ApiRelease.ps1`. The VPS executes `api-release.sh` only when an operator invokes it. No application build or test runs on VPS. `api-release.sh` refuses to migrate until a verified off-VPS restic snapshot succeeds.

Secrets belong in `/etc/ducmy` with mode 600/640, outside release directories. `api.env.example` is a field list, never a working credential file. The API listens on `127.0.0.1:5000` in production. Cloudinary stores uploaded images outside VPS; SQL backups do not include those images.

`restore-check.sh` creates a new `ducmy_restore_*` database and never replaces production. The operator must inspect table and record counts and application integrity before declaring restore readiness. Application rollback changes a symlink only; it does not reverse Prisma migrations or restore a database automatically.
