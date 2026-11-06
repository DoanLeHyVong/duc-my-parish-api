import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { loadMappings } from './migration-lib.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required.');
const targetDatabase = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
if (!/(?:disposable|fixture|smoke|test)/i.test(targetDatabase)) {
  throw new Error('Identity authentication smoke may run only against a database explicitly named disposable, fixture, smoke, or test.');
}

process.env.LOG_LEVEL = 'silent';
const [{ createApp }, { prisma }, { hashPassword }] = await Promise.all([
  import('../../src/app.js'),
  import('../../src/lib/prisma.js'),
  import('../../src/lib/password.js'),
]);

const app = createApp();
const smokeIp = `2001:db8:${randomUUID().replaceAll('-', '').slice(0, 4)}:${randomUUID().replaceAll('-', '').slice(0, 4)}::1`;
const createdSessionIds: string[] = [];
const createdAuditIds: number[] = [];
const login = async (username: string, password: string) => {
  const response = await request(app).post('/api/v1/auth/login').set('X-Forwarded-For', smokeIp).send({ username, password });
  if (response.status !== 200) throw new Error(`Login failed for ${username} with status ${response.status}.`);
  const data = response.body.data as {
    accessToken: string;
    user: { id: string; roles: string[]; permissions: string[] };
  };
  const setCookie = response.headers['set-cookie'];
  const refreshCookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.match(/^refreshToken=([^;]+)/)?.[1];
  if (!refreshCookie) throw new Error(`Login for ${username} did not return a refresh cookie.`);
  const tokenHash = createHash('sha256').update(decodeURIComponent(refreshCookie)).digest('hex');
  const [session, audit] = await Promise.all([
    prisma.authSession.findUnique({ where: { tokenHash }, select: { id: true } }),
    prisma.auditLog.findFirst({
      where: { actorId: data.user.id, action: 'LOGIN', ipAddress: smokeIp },
      orderBy: { id: 'desc' },
      select: { id: true },
    }),
  ]);
  if (session) createdSessionIds.push(session.id);
  if (audit) createdAuditIds.push(audit.id);
  if (!session || !audit) throw new Error(`Could not identify records created by the ${username} smoke login.`);
  return data;
};
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const metadataObject = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

const sourceUsers = await prisma.user.findMany({ where: { username: { in: ['admin', 'parish_admin'] } } });
if (sourceUsers.length !== 2) throw new Error('Expected both migrated identities before authentication smoke testing.');
const mappings = await loadMappings();
const parishMapping = mappings.parishAdminMappings.find((mapping) => mapping.parishAdminId === 1);
if (parishMapping?.resolution !== 'distinct') throw new Error('Expected the approved distinct mapping for Parish Admin 1.');

const originalHashes = new Map(sourceUsers.map((user) => [user.id, user.passwordHash]));
const originalAuthVersions = new Map(sourceUsers.map((user) => [user.id, user.authVersion]));
const originalLastLoginAt = new Map(sourceUsers.map((user) => [user.id, user.lastLoginAt]));
const appglvPassword = `Smoke-${randomUUID()}Aa1!`;
const parishPassword = `Smoke-${randomUUID()}Aa1!`;
const smokeHashes = new Map<string, string>();
let credentialsMutated = false;

try {
  const appglvUser = sourceUsers.find((user) => user.username === 'admin')!;
  const parishUserFixture = sourceUsers.find((user) => user.username === 'parish_admin')!;
  smokeHashes.set(appglvUser.id, await hashPassword(appglvPassword));
  smokeHashes.set(parishUserFixture.id, await hashPassword(parishPassword));
  await prisma.$transaction([
    prisma.user.update({ where: { id: appglvUser.id }, data: { passwordHash: smokeHashes.get(appglvUser.id)!, authVersion: { increment: 1 } } }),
    prisma.user.update({ where: { id: parishUserFixture.id }, data: { passwordHash: smokeHashes.get(parishUserFixture.id)!, authVersion: { increment: 1 } } }),
  ]);
  credentialsMutated = true;

  const appglv = await login('admin', appglvPassword);
  const parish = await login('parish_admin', parishPassword);

  if (!appglv.user.roles.includes('SUPER_ADMIN')) throw new Error('AppGLV administrator lost SUPER_ADMIN.');
  if (!appglv.user.permissions.includes('parish.manage') || !appglv.user.permissions.includes('appglv.manage')) {
    throw new Error('SUPER_ADMIN does not have system-wide permissions.');
  }
  if (parish.user.roles.length !== 1 || parish.user.roles[0] !== 'PARISH_ADMIN') {
    throw new Error('Parish account does not have exactly PARISH_ADMIN.');
  }
  if (parish.user.permissions.includes('appglv.manage') || parish.user.permissions.includes('appglv.teach')) {
    throw new Error('PARISH_ADMIN received AppGLV permissions.');
  }

  const appglvAcademic = await request(app).get('/api/v1/admin/academics/students').set(bearer(appglv.accessToken));
  const appglvPosts = await request(app).get('/api/v1/admin/posts').set(bearer(appglv.accessToken));
  const parishAcademic = await request(app).get('/api/v1/admin/academics/students').set(bearer(parish.accessToken));
  const parishPosts = await request(app).get('/api/v1/admin/posts').set(bearer(parish.accessToken));
  if (appglvAcademic.status !== 200 || appglvPosts.status !== 200) throw new Error('SUPER_ADMIN route coverage failed.');
  if (parishAcademic.status !== 403 || parishPosts.status !== 200) throw new Error('PARISH_ADMIN route isolation failed.');

  const parishUser = await prisma.user.findUniqueOrThrow({ where: { legacyParishAdminId: 1 } });
  if (parishUser.username !== parishMapping.targetUsername) throw new Error('Parish username mapping is incorrect.');
  const postCount = await prisma.post.count({ where: { authorId: parishUser.id } });
  if (postCount !== 15) throw new Error(`Expected 15 preserved Parish posts, found ${postCount}.`);
  const mappingAudits = await prisma.auditLog.findMany({
    where: {
      actorId: parishUser.id,
      entityType: 'User',
      entityId: parishUser.id,
      action: { in: ['IDENTITY_MAPPING_DISTINCT_APPROVED', 'MIGRATION_USERNAME_CHANGED'] },
    },
    select: { action: true, metadata: true },
  });
  const expectedAudits: Record<string, Record<string, unknown>> = {
    IDENTITY_MAPPING_DISTINCT_APPROVED: {
      legacyParishAdminId: parishMapping.parishAdminId,
      approvedBy: parishMapping.approvedBy,
      reason: parishMapping.reason,
    },
    MIGRATION_USERNAME_CHANGED: {
      legacyParishAdminId: parishMapping.parishAdminId,
      from: parishMapping.expectedSourceUsername,
      to: parishMapping.targetUsername,
      approvedBy: parishMapping.approvedBy,
    },
  };
  for (const [action, expectedMetadata] of Object.entries(expectedAudits)) {
    const matching = mappingAudits.filter((row) => row.action === action);
    if (matching.length !== 1) throw new Error(`Expected exactly one ${action} Audit Log, found ${matching.length}.`);
    const actualMetadata = metadataObject(matching[0]!.metadata);
    for (const [key, expected] of Object.entries(expectedMetadata)) {
      if (actualMetadata[key] !== expected) throw new Error(`${action} Audit Log has unexpected ${key} metadata.`);
    }
  }

  console.log(JSON.stringify({
    appglvAuthentication: 'passed',
    parishAuthentication: 'passed',
    superAdminSystemAccess: 'passed',
    parishAppglvIsolation: 'passed',
    preservedParishPosts: postCount,
    identityAuditEntries: mappingAudits.length,
  }));
} finally {
  try {
    await prisma.$transaction(async (tx) => {
      if (credentialsMutated) {
        for (const user of sourceUsers) {
          const restored = await tx.user.updateMany({
            where: {
              id: user.id,
              passwordHash: smokeHashes.get(user.id),
              authVersion: originalAuthVersions.get(user.id)! + 1,
            },
            data: {
              passwordHash: originalHashes.get(user.id)!,
              authVersion: originalAuthVersions.get(user.id)!,
              lastLoginAt: originalLastLoginAt.get(user.id),
            },
          });
          if (restored.count !== 1) throw new Error(`Refusing to overwrite concurrently changed credentials for ${user.username}.`);
        }
      }
      if (createdSessionIds.length) await tx.authSession.deleteMany({ where: { id: { in: createdSessionIds } } });
      if (createdAuditIds.length) await tx.auditLog.deleteMany({ where: { id: { in: createdAuditIds } } });
    });
  } finally {
    await prisma.$disconnect();
  }
}
