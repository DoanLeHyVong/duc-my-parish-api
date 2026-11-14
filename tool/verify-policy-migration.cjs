const fs = require('node:fs');
const { createHash } = require('node:crypto');
const mariadb = require('mariadb');
const dotenv = require('dotenv');

const mode = process.argv[2];
if (!['seed', 'verify', 'cleanup'].includes(mode)) throw new Error('Expected seed, verify, or cleanup.');
const local = dotenv.parse(fs.readFileSync('.env'));
const url = new URL(local.DATABASE_URL);
if (url.protocol !== 'mysql:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Only local MariaDB is allowed.');
const database = 'appglv_unified_test';
const ids = { user: 'policy_migration_test_user', published: 'policy_migration_pub', draft: 'policy_migration_draft' };
const body = '<p>Existing published policy</p>';
const digest = createHash('sha256').update(body).digest('hex');

async function main() {
  const connection = await mariadb.createConnection({ host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database });
  try {
    if (mode === 'seed') {
      await connection.beginTransaction();
      try {
        const existing = await connection.query('SELECT COUNT(*) AS n FROM policies WHERE id IN (?, ?)', [ids.published, ids.draft]);
        if (Number(existing[0].n) !== 0) throw new Error('Synthetic fixtures already exist.');
        await connection.query('INSERT INTO users (id, username, displayName, passwordHash, isActive, authVersion, createdAt, updatedAt) VALUES (?, ?, ?, ?, 0, 1, NOW(), NOW())', [ids.user, ids.user, 'Synthetic migration user', 'synthetic-not-a-login']);
        await connection.query('INSERT INTO policies (id, kind, slug, title, createdAt, updatedAt) VALUES (?, ?, ?, ?, NOW(), NOW()), (?, ?, ?, ?, NOW(), NOW())', [ids.published, 'PRIVACY', 'policy-migration-published', 'Published fixture', ids.draft, 'TERMS', 'policy-migration-draft', 'Draft fixture']);
        await connection.query('INSERT INTO policy_revisions (id, policyId, revision, status, title, contentHtml, contentHash, createdById, publishedById, createdAt, publishedAt) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, NOW(), NOW()), (?, ?, 1, ?, ?, ?, ?, ?, NULL, NOW(), NULL)', ['policy_migration_rev_pub', ids.published, 'PUBLISHED', 'Published fixture', body, digest, ids.user, ids.user, 'policy_migration_rev_draft', ids.draft, 'DRAFT', 'Draft fixture', '<p>Draft fixture</p>', '0'.repeat(64), ids.user]);
        await connection.commit();
      } catch (error) { await connection.rollback(); throw error; }
      console.log('Synthetic pre-migration published and draft policies inserted into test database.');
    } else if (mode === 'verify') {
      const rows = await connection.query('SELECT p.id, p.isActive, r.status, r.contentHtml, r.contentHash FROM policies p JOIN policy_revisions r ON r.policyId = p.id WHERE p.id IN (?, ?) ORDER BY p.id', [ids.published, ids.draft]);
      if (rows.length !== 2) throw new Error('Policy count changed during migration.');
      const published = rows.find((row) => row.id === ids.published);
      const draft = rows.find((row) => row.id === ids.draft);
      if (!published || !draft || Number(published.isActive) !== 1 || Number(draft.isActive) !== 0 || published.status !== 'PUBLISHED' || draft.status !== 'DRAFT' || published.contentHtml !== body || published.contentHash !== digest) throw new Error('Migration did not preserve policy state/content.');
      console.log('Migration preserved 2/2 policies and revisions; published=active, draft=hidden.');
    } else {
      await connection.beginTransaction();
      try {
        await connection.query('DELETE FROM policy_revisions WHERE policyId IN (?, ?)', [ids.published, ids.draft]);
        await connection.query('DELETE FROM policies WHERE id IN (?, ?)', [ids.published, ids.draft]);
        await connection.query('DELETE FROM users WHERE id = ?', [ids.user]);
        await connection.commit();
      } catch (error) { await connection.rollback(); throw error; }
      console.log('Synthetic fixtures removed from test database.');
    }
  } finally { await connection.end(); }
}
main().catch((error) => { console.error('Test migration verification blocked:', error.code || error.message); process.exitCode = 1; });
