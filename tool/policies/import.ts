import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { assertSafePolicyDatabase, importLegacyPolicies } from './import-lib.js';
import { bundledLegacyPolicyDirectory, loadLegacyPolicies } from './legacy.js';

// Require an explicit, local, recognizably isolated target; never fall back to DATABASE_URL.
const raw = process.env.POLICY_DATABASE_URL;
const directory = process.env.LEGACY_POLICY_DIR?.trim() || bundledLegacyPolicyDirectory;
const actor = process.env.POLICY_ACTOR_ID;
const mode = process.argv[2];
if (!raw || !actor || !['--apply', '--check'].includes(mode ?? '') || process.argv.length !== 3) {
  throw new Error('Set POLICY_DATABASE_URL and POLICY_ACTOR_ID; pass --apply or --check. LEGACY_POLICY_DIR is an optional pre-retirement override.');
}
const url = new URL(raw);
const database = decodeURIComponent(url.pathname.slice(1));
if (url.protocol !== 'mysql:' || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) throw new Error('POLICY_DATABASE_URL must use MySQL on the local host.');
assertSafePolicyDatabase(database);
const policies = await loadLegacyPolicies(directory);
const prisma = new PrismaClient({ adapter: new PrismaMariaDb({ host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database, connectionLimit: 2 }) });
try {
  const evidence = await importLegacyPolicies(prisma, mode as '--apply' | '--check', actor, policies);
  console.log(JSON.stringify({ mode, policies: evidence }, null, 2));
} finally { await prisma.$disconnect(); }
