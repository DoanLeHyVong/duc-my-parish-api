import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { RoleCode } from '../src/generated/prisma/client.js';
import { createApp } from '../src/app.js';
import { getEnv } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import { signAccessToken } from '../src/lib/jwt.js';
import { hashPassword } from '../src/lib/password.js';

const app = createApp();
const password = 'Unified@Test123!';

async function cleanDatabase() {
  if (getEnv().DATABASE_NAME !== 'appglv_unified_test') {
    throw new Error('Consolidation tests refuse to clear a database other than appglv_unified_test.');
  }
  await prisma.policyRevision.deleteMany();
  await prisma.policy.deleteMany();
  await prisma.authSession.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.userRoleAssignment.deleteMany();
  await prisma.user.deleteMany();
}

async function createUser(username: string, roles: RoleCode[]) {
  return prisma.user.create({
    data: {
      username,
      displayName: username,
      passwordHash: await hashPassword(password),
      roleAssignments: {
        create: roles.map((code) => ({ role: { connect: { code } } })),
      },
    },
  });
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeEach(cleanDatabase);
afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
});

describe('unified authentication, RBAC, and policies with MariaDB', () => {
  it('keeps the additive login contract and unions permissions across roles', async () => {
    const user = await createUser('unified.admin', [RoleCode.PARISH_ADMIN, RoleCode.APPGLV_ADMIN]);
    const response = await request(app).post('/api/v1/auth/login').send({ username: user.username, password });

    expect(response.status).toBe(200);
    expect(response.headers['set-cookie']?.join(';')).toContain('refreshToken=');
    expect(response.body.data.user.roles).toEqual(expect.arrayContaining([RoleCode.PARISH_ADMIN, RoleCode.APPGLV_ADMIN]));
    expect(response.body.data.user.permissions).toEqual(expect.arrayContaining(['parish.manage', 'appglv.manage', 'policies.manage']));
    expect(response.body.data.admin).toMatchObject({ username: user.username });

    const token = response.body.data.accessToken as string;
    expect((await request(app).get('/api/v1/admin/academics/students').set(bearer(token))).status).toBe(200);
    expect((await request(app).get('/api/v1/admin/posts').set(bearer(token))).status).toBe(200);

    const teacher = await createUser('unified.teacher', [RoleCode.TEACHER]);
    const teacherToken = signAccessToken({ sub: teacher.id, av: teacher.authVersion });
    expect((await request(app).get('/api/v1/admin/posts').set(bearer(teacherToken))).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/academics/students').set(bearer(teacherToken))).status).toBe(403);
  });

  it('protects the last active Super Admin and invalidates sessions after role changes', async () => {
    const admin = await createUser('root.admin', [RoleCode.SUPER_ADMIN]);
    const token = signAccessToken({ sub: admin.id, av: admin.authVersion });

    const blocked = await request(app).put(`/api/v1/admin/security/users/${admin.id}/roles`)
      .set(bearer(token)).send({ roles: [RoleCode.APPGLV_ADMIN] });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('LAST_SUPER_ADMIN_PROTECTED');

    await createUser('backup.admin', [RoleCode.SUPER_ADMIN]);
    await prisma.authSession.create({
      data: { userId: admin.id, tokenHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 60_000) },
    });
    const changed = await request(app).put(`/api/v1/admin/security/users/${admin.id}/roles`)
      .set(bearer(token)).send({ roles: [RoleCode.APPGLV_ADMIN] });
    expect(changed.status).toBe(200);
    expect(changed.body.data.roles).toEqual([RoleCode.APPGLV_ADMIN]);
    expect((await prisma.authSession.findFirstOrThrow({ where: { userId: admin.id } })).revokedAt).not.toBeNull();
    expect((await request(app).get('/api/v1/auth/me').set(bearer(token))).status).toBe(401);
  });

  it('keeps drafts private, sanitizes HTML, and publishes immutable revisions', async () => {
    const parishAdmin = await createUser('policy.admin', [RoleCode.PARISH_ADMIN]);
    const appAdmin = await createUser('app.admin', [RoleCode.APPGLV_ADMIN]);
    const parishToken = signAccessToken({ sub: parishAdmin.id, av: parishAdmin.authVersion });
    const appToken = signAccessToken({ sub: appAdmin.id, av: appAdmin.authVersion });

    expect((await request(app).post('/api/v1/admin/policies').set(bearer(appToken)).send({
      kind: 'PRIVACY', slug: 'privacy', title: 'Privacy', contentHtml: '<p>Denied</p>',
    })).status).toBe(403);

    const created = await request(app).post('/api/v1/admin/policies').set(bearer(parishToken)).send({
      kind: 'PRIVACY', slug: 'privacy', title: 'Privacy',
      contentHtml: '<script>alert(1)</script><p>Safe</p><a href="https://example.org" target="_blank">Link</a>',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.revisions[0].contentHtml).not.toContain('<script>');
    expect(created.body.data.revisions[0].contentHtml).toContain('rel="noopener noreferrer"');
    expect((await request(app).get('/api/v1/public/policies/privacy')).status).toBe(404);

    expect((await request(app).post('/api/v1/admin/policies/privacy/publish').set(bearer(parishToken)).send({ revision: 1 })).status).toBe(200);
    const published = await request(app).get('/api/v1/public/policies/privacy');
    expect(published.status).toBe(200);
    expect(published.body.data).toMatchObject({ slug: 'privacy', revision: 1 });
    expect(published.body.data.contentHtml).toContain('<p>Safe</p>');

    const draft = await request(app).post('/api/v1/admin/policies/privacy/revisions').set(bearer(parishToken)).send({
      title: 'Privacy v2', contentHtml: '<p>Draft only</p>',
    });
    expect(draft.status).toBe(201);
    expect((await request(app).get('/api/v1/public/policies/privacy')).body.data.revision).toBe(1);

    await prisma.policyRevision.update({ where: { id: draft.body.data.id }, data: { contentHtml: '<p>Tampered</p>' } });
    const stale = await request(app).post('/api/v1/admin/policies/privacy/publish').set(bearer(parishToken)).send({ revision: 2 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('STALE_POLICY_REVISION');
  });
});
