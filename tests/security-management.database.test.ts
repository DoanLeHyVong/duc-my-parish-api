import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { RoleCode } from '../src/generated/prisma/client.js';
import { createApp } from '../src/app.js';
import { getEnv } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import { signAccessToken } from '../src/lib/jwt.js';
import { hashPassword } from '../src/lib/password.js';

const app = createApp();
const existingPassword = 'Existing@Test123!';
const initialPassword = 'initial-pass';
let superAdminId: string;
let superAdminToken: string;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function cleanDatabase() {
  if (getEnv().DATABASE_NAME !== 'appglv_unified_test') {
    throw new Error('Security-management tests refuse to clear a database other than appglv_unified_test.');
  }
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
      passwordHash: await hashPassword(existingPassword),
      roleAssignments: { create: roles.map((code) => ({ role: { connect: { code } } })) },
    },
  });
}

beforeEach(async () => {
  await cleanDatabase();
  const superAdmin = await createUser('security.root', [RoleCode.SUPER_ADMIN]);
  superAdminId = superAdmin.id;
  superAdminToken = signAccessToken({ sub: superAdmin.id, av: superAdmin.authVersion });
});

afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
});

describe('managed account security API with MariaDB', () => {
  it('creates an active account with normalized identity, exact roles, and credential-free audit data', async () => {
    const response = await request(app).post('/api/v1/admin/security/users')
      .set(auth(superAdminToken))
      .send({
        username: '  Managed.User  ',
        displayName: '  Tài khoản quản lý  ',
        email: '  MANAGED@EXAMPLE.COM  ',
        password: initialPassword,
        roles: [RoleCode.PARISH_ADMIN, RoleCode.TEACHER, RoleCode.TEACHER, RoleCode.TEACHER, RoleCode.TEACHER],
      });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      username: 'managed.user',
      displayName: 'Tài khoản quản lý',
      email: 'managed@example.com',
      isActive: true,
    });
    expect(response.body.data.roles).toEqual(expect.arrayContaining([RoleCode.PARISH_ADMIN, RoleCode.TEACHER]));
    expect(response.body.data.roles).toHaveLength(2);
    expect(JSON.stringify(response.body)).not.toContain(initialPassword);
    expect(response.body.data).not.toHaveProperty('passwordHash');

    const persisted = await prisma.user.findUniqueOrThrow({
      where: { id: response.body.data.id },
      include: { roleAssignments: { include: { role: true } } },
    });
    expect(persisted.isActive).toBe(true);
    expect(persisted.passwordHash).not.toBe(initialPassword);
    expect(persisted.roleAssignments.map((assignment) => assignment.role.code)).toEqual(
      expect.arrayContaining([RoleCode.PARISH_ADMIN, RoleCode.TEACHER]),
    );

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'USER_CREATED', entityId: persisted.id },
    });
    expect(audit.actorId).toBe(superAdminId);
    expect(audit.metadata).toEqual({ roles: [RoleCode.PARISH_ADMIN, RoleCode.TEACHER] });
    expect(JSON.stringify(audit)).not.toContain(initialPassword);

    const login = await request(app).post('/api/v1/auth/login').send({
      username: 'managed.user',
      password: initialPassword,
    });
    expect(login.status).toBe(200);
    expect(login.body.data.user.roles).toEqual(expect.arrayContaining([RoleCode.PARISH_ADMIN, RoleCode.TEACHER]));
  });

  it.each([RoleCode.PARISH_ADMIN, RoleCode.APPGLV_ADMIN, RoleCode.TEACHER])(
    'denies account creation to %s without changing managed-account data',
    async (role) => {
      const caller = await createUser(`security.${role.toLowerCase()}`, [role]);
      const token = signAccessToken({ sub: caller.id, av: caller.authVersion });
      const before = {
        users: await prisma.user.count(),
        assignments: await prisma.userRoleAssignment.count(),
        audits: await prisma.auditLog.count(),
      };

      const response = await request(app).post('/api/v1/admin/security/users').set(auth(token)).send({
        username: 'denied.user', displayName: 'Denied User', password: initialPassword, roles: [RoleCode.TEACHER],
      });

      expect(response.status).toBe(403);
      expect(await prisma.user.count()).toBe(before.users);
      expect(await prisma.userRoleAssignment.count()).toBe(before.assignments);
      expect(await prisma.auditLog.count()).toBe(before.audits);
    },
  );

  it('denies a non-Super caller even when its role temporarily has security.manage', async () => {
    const role = await prisma.accessRole.findUniqueOrThrow({ where: { code: RoleCode.APPGLV_ADMIN } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'security.manage' } });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    try {
      const caller = await createUser('security.delegated', [RoleCode.APPGLV_ADMIN]);
      const token = signAccessToken({ sub: caller.id, av: caller.authVersion });
      const before = {
        users: await prisma.user.count(),
        assignments: await prisma.userRoleAssignment.count(),
        audits: await prisma.auditLog.count(),
      };

      const response = await request(app).post('/api/v1/admin/security/users').set(auth(token)).send({
        username: 'denied.delegated', displayName: 'Denied Delegated User',
        password: initialPassword, roles: [RoleCode.TEACHER],
      });

      expect(response.status).toBe(403);
      expect(await prisma.user.count()).toBe(before.users);
      expect(await prisma.userRoleAssignment.count()).toBe(before.assignments);
      expect(await prisma.auditLog.count()).toBe(before.audits);
    } finally {
      await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } } });
    }
  });

  it('requires authentication and rejects malformed identity and UTF-8 password byte bounds', async () => {
    const payload = { username: 'valid.user', displayName: 'Valid User', password: initialPassword, roles: [RoleCode.TEACHER] };
    expect((await request(app).post('/api/v1/admin/security/users').send(payload)).status).toBe(401);

    const invalidPayloads = [
      { ...payload, username: 'invalid user' },
      { ...payload, email: 'not-an-email' },
      { ...payload, email: `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(59)}.com` },
      { ...payload, password: 'a'.repeat(11) },
      { ...payload, password: 'é'.repeat(37) },
      { ...payload, roles: [] },
    ];
    for (const invalidPayload of invalidPayloads) {
      const response = await request(app).post('/api/v1/admin/security/users')
        .set(auth(superAdminToken)).send(invalidPayload);
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('returns safe identity conflicts without partial users, roles, or audits', async () => {
    await request(app).post('/api/v1/admin/security/users').set(auth(superAdminToken)).send({
      username: 'conflict.user', displayName: 'Conflict User', email: 'conflict@example.com',
      password: initialPassword, roles: [RoleCode.APPGLV_ADMIN],
    });
    const before = {
      users: await prisma.user.count(),
      assignments: await prisma.userRoleAssignment.count(),
      audits: await prisma.auditLog.count(),
    };

    for (const identity of [
      { username: ' CONFLICT.USER ', email: 'different@example.com' },
      { username: 'different.user', email: ' CONFLICT@EXAMPLE.COM ' },
    ]) {
      const response = await request(app).post('/api/v1/admin/security/users').set(auth(superAdminToken)).send({
        ...identity, displayName: 'Another User', password: initialPassword, roles: [RoleCode.TEACHER],
      });
      expect(response.status).toBe(409);
      expect(response.body.error).toMatchObject({ code: 'IDENTITY_CONFLICT' });
      expect(JSON.stringify(response.body)).not.toContain(identity.username.trim().toLowerCase());
    }
    expect(await prisma.user.count()).toBe(before.users);
    expect(await prisma.userRoleAssignment.count()).toBe(before.assignments);
    expect(await prisma.auditLog.count()).toBe(before.audits);
  });

  it('rejects Super Admin creation and promotion while preserving exactly one Super Admin', async () => {
    const managed = await createUser('security.managed', [RoleCode.TEACHER]);
    const beforeAssignments = await prisma.userRoleAssignment.count({ where: { userId: managed.id } });

    const createResponse = await request(app).post('/api/v1/admin/security/users')
      .set(auth(superAdminToken)).send({
        username: 'second.root', displayName: 'Second Root', password: initialPassword,
        roles: [RoleCode.SUPER_ADMIN],
      });
    expect(createResponse.status).toBe(409);
    expect(createResponse.body.error.code).toBe('SUPER_ADMIN_INVARIANT');

    const promoteResponse = await request(app).put(`/api/v1/admin/security/users/${managed.id}/roles`)
      .set(auth(superAdminToken)).send({ roles: [RoleCode.TEACHER, RoleCode.SUPER_ADMIN] });
    expect(promoteResponse.status).toBe(409);
    expect(promoteResponse.body.error.code).toBe('SUPER_ADMIN_INVARIANT');
    expect(await prisma.userRoleAssignment.count({ where: { userId: managed.id } })).toBe(beforeAssignments);
    expect(await prisma.auditLog.count()).toBe(0);
    expect(await prisma.user.count({
      where: { roleAssignments: { some: { role: { code: RoleCode.SUPER_ADMIN } } }, isActive: true, deletedAt: null },
    })).toBe(1);
  });
});
