# Legacy policy draft import

The importer accepts only the four fingerprinted source pages. Byte-exact copies are retained in `legacy-source/` so the unified repository remains self-contained after workspace retirement. It strips page chrome and unresolved contact placeholders, maps internal links to clean routes, sanitizes the remaining main content and emits source and normalized SHA-256 evidence. The restricted external archive remains the recovery authority. Changes to the source require human review before these fingerprints can be updated.

Set `POLICY_DATABASE_URL` to an explicitly selected local unified/disposable/test MySQL database and `POLICY_ACTOR_ID` to an existing user ID. The bundled source is used by default; set `LEGACY_POLICY_DIR` only to compare a pre-retirement source directory. Run `npm run policies:legacy -- --apply` to create missing draft revisions, then `npm run policies:legacy -- --check` to compare them. Both operations fail closed on conflicting existing content. The transaction adds audit records and never publishes. Securely retain the JSON output as parity evidence. This name-based guard is not a substitute for confirming that the selected database is not a source database before applying.

Contact details must be supplied and all content reviewed by legal owners before any separate publication decision.
