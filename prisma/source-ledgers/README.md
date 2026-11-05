# Preserved source migration ledgers

These SQL files are immutable evidence copied from the Parish and AppGLV repositories at consolidation time.

They are intentionally outside `prisma/migrations`. Never replay either ledger against the other source database or the unified database. The active migration path starts with `202611050001_unified_baseline` and targets a newly created, disposable database only.
