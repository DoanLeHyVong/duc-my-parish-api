# Single-VPS deployment (not activated)

The approved target is one authorized Vultr Ubuntu VPS, one Compose project, one MariaDB database, one API, one Nginx-served Web image, and one Cloudflare tunnel named `ducmy-production`. Current hosts: `giaoxu.hyvongofficial.online` (Web) and `api.hyvongofficial.online` (API). No remote deployment or DNS change has been performed.

## GitHub gates

`staging` runs CI only. Successful `main` CI can trigger the deploy workflow, but both **repository-level** variables `PRODUCTION_DEPLOY_ENABLED` and `PRODUCTION_READINESS_CONFIRMED` must be `true`. Leave both unset or `false` until the owner verifies VPS ownership, backup/restore, tunnel routing, production credentials and smoke tests. GitHub Environment `production` holds SSH secrets. A required reviewer blocks every run; remove that per-run approval only when automatic deployment is activated. Protect `main` with required CI checks. Deploy workflows must be present on the default branch to receive `workflow_run` events.

Images are built in Actions and pushed to GHCR with `production-<commit SHA>` tags. VPS secrets `VPS_HOST`, `VPS_PORT`, `VPS_USER`, `VPS_SSH_KEY` belong in each repository's production Environment. Set repository variable `PRODUCTION_DEPLOY_PATH` to the same project path in API and Web repositories. Place read-only GHCR pull credentials in `/etc/ducmy/production/ghcr-token` on the VPS, never in Git. Initial deployment requires both image tags to exist in the Compose env file.

## One VPS project

Use one `/opt/ducmy/production` directory and `COMPOSE_PROJECT_NAME=ducmy-production`. Copy `docker-compose.yml`, `.env.production*.example` and `scripts/` there, creating real `.env.production`, `.env.production.api`, `.env.production.db` with restrictive permissions. Use one `ducmy` MariaDB database. Generate random database/JWT secrets; URL-encode the database password in `DATABASE_URL`. MariaDB has no published port. Set the `ducmy-production` tunnel to Web `http://web:80` and API `http://api:5000`. No staging tunnel or database is needed.

For 1 vCPU / 2 GB, Compose limits MariaDB to 640 MB, API to 512 MB (Node heap 384 MB), Nginx to 96 MB, and cloudflared to 128 MB. Measure actual memory use before activation. Enable persistent swap (for example 1–2 GB), restrict SSH, patch Ubuntu and monitor memory, disk, container health, backup age and tunnel health. Swap is emergency headroom. The exact backup provider and monitoring system remain operator choices.

## Off-VPS backup and rollback

Install `restic` and configure an off-VPS repository (`s3:`, `b2:`, `rest:`, `sftp:`, `rclone:`, `azure:`, `gs:` or `swift:`). Keep its password at `/etc/ducmy/production/restic-password`; store provider credentials outside Git. Initialize using process-local environment, then verify `restic snapshots` and restore to a disposable database. `deploy.sh` refuses to proceed if off-VPS storage is unavailable. On an existing DB, it creates a SQL dump, SHA-256 file and off-VPS restic snapshot before changing image tags or running migrations.

Install the example `systemd/ducmy-backup*` units into `/etc/systemd/system/` after reviewing the service account, paths and permissions, then run `systemctl daemon-reload` and `systemctl enable --now ducmy-backup.timer ducmy-backup-prune.timer`. The first timer runs every six hours; weekly pruning keeps off-VPS snapshots within 30 days plus six monthly snapshots. Pruning is kept off the six-hour path on the small VPS. After a successful off-VPS snapshot, local SQL dumps older than 48 hours are removed. Configure `/etc/ducmy/production/alert-webhook` as a mode-600 file containing the owner-approved HTTPS JSON webhook; the alert service sends only the failed unit name. Test failure alerts and a disposable restore before activating production. Rehearse restore quarterly and after major infrastructure changes. Scheduling alone does not prove the approved RPO ≤ 6 hours / RTO ≤ 8 hours.

After authorization run `./scripts/deploy.sh .env.production`, then `API_URL=https://api.hyvongofficial.online EXPECTED_API_URL=https://api.hyvongofficial.online/api/v1 WEB_URL=https://giaoxu.hyvongofficial.online ./scripts/smoke.sh`. Application rollback: `./scripts/rollback.sh .env.production <previous-api-image> <previous-web-image>`. It does not reverse database migrations; assess compatibility first.

The local positive/negative smoke contract check is `node --test deploy/tests/smoke.check.mjs`; it does not require VPS access.

The API workflow uploads the versioned `deploy/` bundle to the VPS before deployment. Its script holds the shared lock while backing up the current database, applying the new Compose/scripts, updating images and running public smoke checks. Web deployments use the same lock and current bundle. Pin the VPS SSH host fingerprint in both GitHub Environments as `VPS_HOST_FINGERPRINT`. Keep `PUBLIC_API_URL` and `PUBLIC_WEB_URL` without trailing slashes in both GitHub variables and the VPS env file. Initial operator setup must provision the latest bundle and real env files before the gate is opened. If a live staging environment exists despite the earlier blocked report, stop and reconcile/restore its data and verify tunnel route ownership before switching traffic; these templates do not migrate live data automatically.

## Mobile and future domains

Flutter release builds use `API_BASE_URL=https://api.hyvongofficial.online/api/v1` and `PUBLIC_WEB_BASE_URL=https://giaoxu.hyvongofficial.online`. These are compiled into the app. A later API domain switch requires a new app release unless secure remote configuration is designed separately. When the owner later acquires `giaoxuducmy.org`, update GitHub `PUBLIC_API_URL`/`PUBLIC_WEB_URL`, VPS `CLIENT_URL`, Web build args, Compose public URLs, Cloudflare DNS/tunnel, HTTPS, policy URLs and Flutter release config together. Do not switch now. Tekino resources remain untouched.
