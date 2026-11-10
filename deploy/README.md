# Docker Compose deployment

This directory contains deployment templates for the unified API, Parish Web image, private MariaDB, and a dedicated Cloudflare Tunnel. It does not contain credentials or a live tunnel token.

## VPS layout

Use a separate directory and Compose project for each environment, for example `/opt/ducmy/staging` and `/opt/ducmy/production`. Copy `docker-compose.yml`, the matching `.env.*.example` files, and the checked-in scripts/config examples. Create real `.env.staging`, `.env.staging.db`, `.env.staging.api` (and production equivalents) outside Git with restrictive permissions.

The database service is reachable only inside the Compose network; no `ports` mapping is defined for MariaDB. Use different volumes, database names, JWT secrets, Cloudflare tunnel tokens, and deploy paths for staging and production.

## First staging setup

1. Verify the VPS is personally owned/authorized, Docker Compose is installed, and firewall rules expose only SSH and the Cloudflare connector.
2. Generate long random values for `MARIADB_PASSWORD`, `MARIADB_ROOT_PASSWORD`, `JWT_ACCESS_SECRET`, and `JWT_REFRESH_SECRET`. Put them only in the VPS secret files; URL-encode database password characters in `DATABASE_URL`.
3. Set `API_IMAGE` and `WEB_IMAGE` to the GitHub Container Registry tags produced by the workflows.
4. Supply the `ducmy-staging` Cloudflare Tunnel token only in the VPS environment file. Route `giaoxu.hyvongofficial.online` to `web:80` and `api.hyvongofficial.online` to `api:5000` in Cloudflare.
5. Run `./scripts/deploy.sh .env.staging`, then `API_URL=https://api.hyvongofficial.online WEB_URL=https://giaoxu.hyvongofficial.online ./scripts/smoke.sh`.

## Backup and rollback

Run `BACKUP_DIR=/var/backups/ducmy ./scripts/backup-db.sh .env.staging` before migrations or release changes. The script writes SQL and SHA-256 files outside the repository with mode 600. Store an off-host copy according to the approved backup policy.

Application rollback is `./scripts/rollback.sh .env.staging <previous-api-image> <previous-web-image>`. It does not reverse database migrations. Stop and assess if the new migration is not compatible with the previous application release.

## Synthetic review accounts

Create a credentials directory outside the repository, then run the script against the staging Compose service with a mounted output path:

```sh
mkdir -p /var/lib/ducmy-secrets
chmod 700 /var/lib/ducmy-secrets
docker compose --env-file .env.staging -f docker-compose.yml run --rm \
  -v /var/lib/ducmy-secrets:/run/synthetic \
  -e SYNTHETIC_CREDENTIALS_FILE=/run/synthetic/accounts.json \
  api npx tsx tool/deploy/provision-synthetic-accounts.ts
chmod 600 /var/lib/ducmy-secrets/accounts.json
```

The script generates unique passwords in memory and writes them once to the operator-controlled file. Do not paste the file into chat, commit it, or put it in GitHub Actions logs.

## Cloudflare and legacy audit

Export the zone records, tunnel inventory, and published routes before any change. This workflow only audits and exports legacy Tekino resources; it does not delete them. Never remove MX, SPF, DKIM, DMARC, company-serving routes, or resources with ambiguous ownership.
