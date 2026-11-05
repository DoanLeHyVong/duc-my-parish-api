# Unified database assembly

This workflow only targets a newly baselined database. It never alters either source.

1. Apply `prisma/migrations/202611050001_unified_baseline` to a new database whose name contains `unified`, `consolidat`, `merge`, `disposable`, or `test`.
2. Set `PARISH_SOURCE_DATABASE_URL`, `APPGLV_SOURCE_DATABASE_URL`, and `DATABASE_URL` to three distinct MySQL databases.
3. If a Parish Admin is the same real account as an AppGLV User, copy `identity-mapping.example.json`, record the explicit reviewed mapping, and set `IDENTITY_MAPPING_FILE`. The importer never matches by name, username, or email.
4. Run `npm run migration:dry-run` twice. Each run imports transactionally, reconciles counts/FKs, writes non-sensitive evidence under the ignored `tool/migration/evidence/` directory, and rolls back.
5. Review mappings and evidence. Only then run `npm run migration:apply`.
6. Run `npm run migration:reconcile`, backup the new database, and rehearse restore before any separately authorized cutover.

Rollback before cutover means discarding the new database and retaining both untouched sources. No command here drops a database automatically.
