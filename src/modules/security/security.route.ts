import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Prisma, RoleCode } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { ApiError } from '../../lib/api-error.js';
import { authenticate } from '../../middleware/auth.js';
import { authorize, Permission } from '../../middleware/authorize.js';

const userIdSchema = z.object({ id: z.string().min(1).max(30) });
const rolesSchema = z.object({ roles: z.array(z.enum(RoleCode)).min(1).max(4) });
const createUserSchema = z.object({
  username: z.string().trim().min(3).max(64).transform((value) => value.toLowerCase()),
  displayName: z.string().trim().min(2).max(120),
  email: z.email().optional(),
  password: z.string().min(10).max(200),
  roles: z.array(z.enum(RoleCode)).min(1).max(4),
});
const includeAccess = { roleAssignments: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } as const;

function safeUser<T extends { passwordHash: string; roleAssignments: Array<{ role: { code: RoleCode; permissions: Array<{ permission: { code: string } }> } }> }>(user: T) {
  const { passwordHash: _passwordHash, roleAssignments, ...rest } = user;
  void _passwordHash;
  return {
    ...rest,
    roles: roleAssignments.map((assignment) => assignment.role.code),
    permissions: [...new Set(roleAssignments.flatMap((assignment) => assignment.role.permissions.map((entry) => entry.permission.code)))],
  };
}

export const securityRouter = Router();
securityRouter.use(authenticate, authorize(Permission.SECURITY_MANAGE));

securityRouter.get('/roles', asyncHandler(async (_request, response) => {
  const roles = await prisma.accessRole.findMany({ orderBy: { code: 'asc' }, include: { permissions: { include: { permission: true } }, _count: { select: { assignments: true } } } });
  response.json({ data: roles.map((role) => ({ id: role.id, code: role.code, name: role.name, userCount: role._count.assignments, permissions: role.permissions.map((item) => item.permission.code) })) });
}));

securityRouter.get('/users', asyncHandler(async (_request, response) => {
  const users = await prisma.user.findMany({ include: includeAccess, orderBy: { displayName: 'asc' } });
  response.json({ data: users.map(safeUser) });
}));

securityRouter.post('/users', asyncHandler(async (request, response) => {
  const input = createUserSchema.parse(request.body);
  const passwordHash = await bcrypt.hash(input.password, 12);
  try {
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          username: input.username,
          displayName: input.displayName,
          email: input.email?.toLowerCase(),
          passwordHash,
          roleAssignments: { create: input.roles.map((code) => ({ role: { connect: { code } }, assignedBy: request.auth!.userId })) },
        },
        include: includeAccess,
      });
      await tx.auditLog.create({ data: { actorId: request.auth!.userId, action: 'USER_CREATED', entityType: 'user', entityId: created.id, metadata: { roles: input.roles }, ipAddress: request.ip } });
      return created;
    });
    response.status(201).json({ data: safeUser(user) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ApiError(409, 'IDENTITY_CONFLICT', 'Tên đăng nhập hoặc email đã tồn tại.');
    throw error;
  }
}));

securityRouter.put('/users/:id/roles', asyncHandler(async (request, response) => {
  const { id } = userIdSchema.parse(request.params);
  const input = rolesSchema.parse(request.body);
  const desired = [...new Set(input.roles)];
  const changed = await prisma.$transaction(async (tx) => {
    const current = await tx.user.findUnique({ where: { id }, include: includeAccess });
    if (!current) throw new ApiError(404, 'USER_NOT_FOUND', 'Không tìm thấy người dùng.');
    const currentRoles = current.roleAssignments.map((assignment) => assignment.role.code);
    if (currentRoles.includes(RoleCode.SUPER_ADMIN) && !desired.includes(RoleCode.SUPER_ADMIN)) {
      const activeSuperAdmins = await tx.$queryRawUnsafe<Array<{ id: string }>>("SELECT u.id FROM users u INNER JOIN user_role_assignments ura ON ura.userId = u.id INNER JOIN access_roles ar ON ar.id = ura.roleId WHERE ar.code = 'SUPER_ADMIN' AND u.isActive = TRUE AND u.deletedAt IS NULL ORDER BY u.id FOR UPDATE");
      if (activeSuperAdmins.length <= 1) throw new ApiError(409, 'LAST_SUPER_ADMIN_PROTECTED', 'Không thể gỡ vai trò của Super Admin hoạt động cuối cùng.');
    }
    await tx.userRoleAssignment.deleteMany({ where: { userId: id, role: { code: { notIn: desired } } } });
    for (const code of desired) {
      const role = await tx.accessRole.findUniqueOrThrow({ where: { code } });
      await tx.userRoleAssignment.upsert({ where: { userId_roleId: { userId: id, roleId: role.id } }, create: { userId: id, roleId: role.id, assignedBy: request.auth!.userId }, update: {} });
    }
    await tx.user.update({ where: { id }, data: { authVersion: { increment: 1 } } });
    await tx.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.auditLog.create({ data: { actorId: request.auth!.userId, action: 'USER_ROLES_CHANGED', entityType: 'user', entityId: id, metadata: { before: currentRoles, after: desired }, ipAddress: request.ip } });
    return tx.user.findUniqueOrThrow({ where: { id }, include: includeAccess });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  response.json({ data: safeUser(changed) });
}));
