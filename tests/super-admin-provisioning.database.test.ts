import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { getEnv } from '../src/config/env.js';
import { RoleCode } from '../src/generated/prisma/client.js';
import { signAccessToken } from '../src/lib/jwt.js';
import { hashPassword } from '../src/lib/password.js';
import { prisma } from '../src/lib/prisma.js';
import {
  assertLocalDucmyDatabaseUrl,
  provisionSuperAdmin,
  readSuperAdminProvisioningEnvironment,
  SuperAdminProvisioningError,
} from '../tool/security/super-admin-provisioning.js';

const app = createApp();
const oldPassword = `Provision@Old123!${process.pid}`;
const newPassword = `Provision@New123!${process.pid}`;

async function cleanDatabase(): Promise<void> {
  if (getEnv().DATABASE_NAME !== 'appglv_unified_test') {
    throw new Error('Super Admin provisioning tests refuse to clear a database other than appglv_unified_test.');
  }
  await prisma.authSession.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.userRoleAssignment.deleteMany();
  await prisma.user.deleteMany();
}

async function createUser(username: string, role: RoleCode, email?: string) {
  return prisma.user.create({
    data: {
      username,
      email,
      displayName: username,
      passwordHash: await hashPassword(oldPassword),
      roleAssignments: { create: { role: { connect: { code: role } } } },
    },
    include: { roleAssignments: true },
  });
}

beforeEach(cleanDatabase);
afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
});

describe('Super Admin provisioning with MariaDB', () => {
  it('renames the same identity, preserves history and roles, revokes sessions, and invalidates access tokens', async () => {
    const user = await createUser('admin', RoleCode.SUPER_ADMIN, 'admin@local.invalid');
    const originalRole = user.roleAssignments[0]!;
    const originalAudit = await prisma.auditLog.create({
      data: { actorId: user.id, action: 'EXISTING_HISTORY', entityType: 'User', entityId: user.id },
    });
    const session = await prisma.authSession.create({
      data: { userId: user.id, tokenHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 60_000) },
    });
    await prisma.authSession.create({
      data: {
        userId: user.id,
        tokenHash: 'c'.repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: new Date(),
      },
    });
    const oldAccessToken = signAccessToken({ sub: user.id, av: user.authVersion });

    const result = await provisionSuperAdmin(prisma, {
      sourceUsername: 'ADMIN',
      targetUsername: 'New.Admin',
      password: newPassword,
    });

    const updated = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { roleAssignments: { include: { role: true } } },
    });
    expect(result).toMatchObject({
      userId: user.id,
      targetUsername: 'new.admin',
      repeated: false,
      revokedSessions: 1,
    });
    expect(updated.id).toBe(user.id);
    expect(updated.username).toBe('new.admin');
    expect(updated.email).toBe('admin@local.invalid');
    expect(updated.authVersion).toBe(user.authVersion + 1);
    expect(await bcrypt.compare(newPassword, updated.passwordHash)).toBe(true);
    expect(updated.roleAssignments).toHaveLength(1);
    expect(updated.roleAssignments[0]).toMatchObject({ userId: originalRole.userId, roleId: originalRole.roleId });
    expect(updated.roleAssignments[0]!.role.code).toBe(RoleCode.SUPER_ADMIN);
    expect(await prisma.auditLog.findUnique({ where: { id: originalAudit.id } })).not.toBeNull();
    expect((await prisma.authSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).not.toBeNull();
    expect((await request(app).get('/api/v1/auth/me').set({ Authorization: `Bearer ${oldAccessToken}` })).status).toBe(401);

    const provisionAudit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: user.id, action: 'SUPER_ADMIN_PROVISIONED' },
    });
    const serializedMetadata = JSON.stringify(provisionAudit.metadata);
    expect(provisionAudit.actorId).toBeNull();
    expect(provisionAudit.entityId).toBe(user.id);
    expect(provisionAudit.metadata).toMatchObject({
      previousUsername: 'admin',
      newUsername: 'new.admin',
      initiatedBy: 'system',
      environment: 'local',
    });
    expect(serializedMetadata).not.toContain(newPassword);
    expect(serializedMetadata.toLowerCase()).not.toContain('hash');
  });

  it('is safely repeatable and authenticates only the new credential with SUPER_ADMIN access', async () => {
    const user = await createUser('admin', RoleCode.SUPER_ADMIN);
    await provisionSuperAdmin(prisma, {
      sourceUsername: 'admin', targetUsername: 'new.admin', password: newPassword,
    });
    const secondSession = await prisma.authSession.create({
      data: { userId: user.id, tokenHash: 'b'.repeat(64), expiresAt: new Date(Date.now() + 60_000) },
    });

    await expect(provisionSuperAdmin(prisma, {
      sourceUsername: 'mistyped.admin', targetUsername: 'new.admin', password: newPassword,
    })).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).authVersion).toBe(user.authVersion + 1);

    const second = await provisionSuperAdmin(prisma, {
      sourceUsername: 'admin', targetUsername: 'new.admin', password: newPassword,
    });

    expect(second.repeated).toBe(true);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.userRoleAssignment.count()).toBe(1);
    expect((await prisma.authSession.findUniqueOrThrow({ where: { id: secondSession.id } })).revokedAt).not.toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).authVersion).toBe(user.authVersion + 2);
    expect((await request(app).post('/api/v1/auth/login').send({ username: 'admin', password: oldPassword })).status).toBe(401);
    const login = await request(app).post('/api/v1/auth/login').send({ username: 'new.admin', password: newPassword });
    expect(login.status).toBe(200);
    expect(login.body.data.user.roles).toContain(RoleCode.SUPER_ADMIN);
    expect((await request(app).get('/api/v1/admin/security/users').set({
      Authorization: `Bearer ${login.body.data.accessToken as string}`,
    })).status).toBe(200);
  });

  it('updates a non-colliding target email', async () => {
    const user = await createUser('admin', RoleCode.SUPER_ADMIN, 'old@local.invalid');

    await provisionSuperAdmin(prisma, {
      sourceUsername: 'admin',
      targetUsername: 'new.admin',
      targetEmail: 'NEW@LOCAL.INVALID',
      password: newPassword,
    });

    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe('new@local.invalid');
  });

  it('fails closed on username or email collisions without changing the source', async () => {
    const source = await createUser('admin', RoleCode.SUPER_ADMIN, 'admin@local.invalid');
    await createUser('occupied', RoleCode.TEACHER, 'occupied@local.invalid');

    await expect(provisionSuperAdmin(prisma, {
      sourceUsername: 'admin', targetUsername: 'occupied', password: newPassword,
    })).rejects.toMatchObject({ code: 'TARGET_USERNAME_COLLISION' });
    await expect(provisionSuperAdmin(prisma, {
      sourceUsername: 'admin', targetUsername: 'new.admin', targetEmail: 'occupied@local.invalid', password: newPassword,
    })).rejects.toMatchObject({ code: 'TARGET_EMAIL_COLLISION' });

    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: source.id } });
    expect(unchanged.username).toBe('admin');
    expect(unchanged.email).toBe('admin@local.invalid');
    expect(unchanged.authVersion).toBe(source.authVersion);
    expect(await bcrypt.compare(oldPassword, unchanged.passwordHash)).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'SUPER_ADMIN_PROVISIONED' } })).toBe(0);
  });

  it('never creates or promotes an account when the locator is missing or not a Super Admin', async () => {
    await expect(provisionSuperAdmin(prisma, {
      sourceUsername: 'missing', targetUsername: 'new.admin', password: newPassword,
    })).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });

    const teacher = await createUser('teacher', RoleCode.TEACHER);
    await expect(provisionSuperAdmin(prisma, {
      sourceUsername: 'teacher', targetUsername: 'new.admin', password: newPassword,
    })).rejects.toMatchObject({ code: 'SOURCE_NOT_SUPER_ADMIN' });
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.userRoleAssignment.findFirstOrThrow({ where: { userId: teacher.id } })).toMatchObject({
      userId: teacher.id,
    });
  });

  it('rejects inactive and deleted Super Admin identities', async () => {
    const user = await createUser('admin', RoleCode.SUPER_ADMIN);
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    await expect(provisionSuperAdmin(prisma, {
      sourceUsername: 'admin', targetUsername: 'new.admin', password: newPassword,
    })).rejects.toMatchObject({ code: 'SOURCE_NOT_ACTIVE' });

    await prisma.user.update({
      where: { id: user.id },
      data: { isActive: true, deletedAt: new Date() },
    });
    await expect(provisionSuperAdmin(prisma, {
      sourceUsername: 'admin', targetUsername: 'new.admin', password: newPassword,
    })).rejects.toMatchObject({ code: 'SOURCE_NOT_ACTIVE' });
    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(unchanged.username).toBe('admin');
    expect(unchanged.authVersion).toBe(user.authVersion);
    expect(await bcrypt.compare(oldPassword, unchanged.passwordHash)).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'SUPER_ADMIN_PROVISIONED' } })).toBe(0);
  });

  it('refuses an ambiguous database containing multiple Super Admin identities', async () => {
    const first = await createUser('admin', RoleCode.SUPER_ADMIN);
    await createUser('other.admin', RoleCode.SUPER_ADMIN);

    await expect(provisionSuperAdmin(prisma, {
      sourceUsername: 'admin', targetUsername: 'new.admin', password: newPassword,
    })).rejects.toMatchObject({ code: 'SUPER_ADMIN_IDENTITY_AMBIGUOUS' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: first.id } })).username).toBe('admin');
  });
});

describe('Super Admin provisioning environment guards', () => {
  it('normalizes valid environment input and accepts only local ducmy URLs', () => {
    const input = readSuperAdminProvisioningEnvironment({
      SUPER_ADMIN_SOURCE_USERNAME: ' Admin ',
      SUPER_ADMIN_TARGET_USERNAME: ' New.Admin ',
      SUPER_ADMIN_PASSWORD: 'lowercaseonlypassword',
    });
    expect(input).toMatchObject({ sourceUsername: 'admin', targetUsername: 'new.admin' });
    expect(() => assertLocalDucmyDatabaseUrl('mysql://localhost:3306/ducmy')).not.toThrow();
    expect(() => assertLocalDucmyDatabaseUrl('mysql://example.com:3306/ducmy')).toThrowError(
      expect.objectContaining({ code: 'UNSAFE_DATABASE' }),
    );
    expect(() => assertLocalDucmyDatabaseUrl('mysql://localhost:3306/production')).toThrowError(
      expect.objectContaining({ code: 'UNSAFE_DATABASE' }),
    );
    expect(() => assertLocalDucmyDatabaseUrl('mysql://localhost:3306/d%75cmy')).toThrowError(
      expect.objectContaining({ code: 'UNSAFE_DATABASE' }),
    );
    expect(() => assertLocalDucmyDatabaseUrl('mysql://localhost:3306/ducmy/')).toThrowError(
      expect.objectContaining({ code: 'UNSAFE_DATABASE' }),
    );
  });

  it('requires the dedicated password and enforces bcrypt UTF-8 byte limits', () => {
    const base = {
      SUPER_ADMIN_SOURCE_USERNAME: 'admin',
      SUPER_ADMIN_TARGET_USERNAME: 'new.admin',
    };
    expect(() => readSuperAdminProvisioningEnvironment({
      ...base,
      SEED_ADMIN_PASSWORD: newPassword,
    })).toThrowError(expect.objectContaining({ code: 'MISSING_ENV' }));
    expect(() => readSuperAdminProvisioningEnvironment({
      ...base,
      SUPER_ADMIN_PASSWORD: 'a'.repeat(11),
    })).toThrowError(expect.objectContaining({ code: 'INVALID_ENV' }));
    expect(() => readSuperAdminProvisioningEnvironment({
      ...base,
      SUPER_ADMIN_PASSWORD: 'é'.repeat(36),
    })).not.toThrow();
    expect(() => readSuperAdminProvisioningEnvironment({
      ...base,
      SUPER_ADMIN_PASSWORD: 'é'.repeat(37),
    })).toThrowError(expect.objectContaining({ code: 'INVALID_ENV' }));
  });

  it('names invalid variables without including their values', () => {
    const secret = 'not-valid';
    expect(() => readSuperAdminProvisioningEnvironment({
      SUPER_ADMIN_SOURCE_USERNAME: 'admin',
      SUPER_ADMIN_TARGET_USERNAME: 'new.admin',
      SUPER_ADMIN_PASSWORD: secret,
    })).toThrowError(SuperAdminProvisioningError);
    try {
      readSuperAdminProvisioningEnvironment({
        SUPER_ADMIN_SOURCE_USERNAME: 'admin',
        SUPER_ADMIN_TARGET_USERNAME: 'new.admin',
        SUPER_ADMIN_PASSWORD: secret,
      });
    } catch (error) {
      expect(String(error)).toContain('SUPER_ADMIN_PASSWORD');
      expect(String(error)).not.toContain(secret);
    }
  });
});
