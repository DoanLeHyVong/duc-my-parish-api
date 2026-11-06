# Unified database assembly

This workflow only targets a newly baselined database. It never alters either source.

1. Apply `prisma/migrations/202611050001_unified_baseline` to a new database whose name contains `unified`, `consolidat`, `merge`, `disposable`, or `test`.
2. Set `PARISH_SOURCE_DATABASE_URL`, `APPGLV_SOURCE_DATABASE_URL`, and `DATABASE_URL` to three distinct MySQL databases.
3. Copy `identity-mapping.example.json` and record every reviewed collision as either `merge` (one real person, with `expectedSourceUsername` and the reviewed AppGLV `targetUserId`) or `distinct` (separate account, with `expectedSourceUsername` and an approved unique `targetUsername`). Set `IDENTITY_MAPPING_FILE` to that reviewed file. The importer never infers identity from name, username, or email, and a distinct resolution does not waive an email collision.
4. Run `npm run migration:dry-run` twice. Each run imports transactionally, reconciles counts/FKs, writes non-sensitive evidence under the ignored `tool/migration/evidence/` directory, and rolls back.
5. Review mappings and evidence. Only then run `npm run migration:apply` against the disposable target. Approved distinct mappings preserve the Parish password only when it is a compatible bcrypt hash, create only the `PARISH_ADMIN` assignment, and add mapping/username-change Audit Logs.
6. Run `npm run migration:reconcile`, backup the new database, and rehearse restore before any separately authorized cutover.

## Identity authentication smoke

`npm run smoke:identity-migration` is destructive fixture verification and must run only on an isolated, disposable target whose database name contains `disposable`, `fixture`, `smoke`, or `test`. It refuses other targets. Keep `IDENTITY_MAPPING_FILE` set to the exact approved mapping used for the import, ensure the migrated `admin` and `parish_admin` fixtures and expected Parish posts are present, and do not allow concurrent use of those fixture accounts while it runs.

The smoke temporarily replaces both fixture password hashes and increments their auth versions, performs real logins and RBAC requests, and verifies one exact migration audit for each required action and metadata set. Cleanup restores the original hashes, auth versions, and `lastLoginAt` only if the temporary credentials are still unchanged, and deletes only the sessions and login audits whose exact IDs were created by the smoke. A concurrent credential change makes guarded restoration fail instead of being overwritten; discard and rebuild that disposable target before retrying.

Rollback before cutover means discarding the new database and retaining both untouched sources. No command here drops a database automatically.
