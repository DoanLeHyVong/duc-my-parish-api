import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Prisma, RoleCode } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { ApiError } from '../../lib/api-error.js';
import { authenticate } from '../../middleware/auth.js';
import { authorize, authorizeRole, Permission } from '../../middleware/authorize.js';

const userIdSchema = z.object({ id: z.string().min(1).max(30) });
const rolesSchema = z.object({ roles: z.array(z.enum(RoleCode)).min(1).max(4) });
const createUserSchema = z.object({
  username: z.string().trim().min(3).max(64).regex(/^[A-Za-z0-9._-]+$/).transform((value) => value.toLowerCase()),
  displayName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().pipe(z.email().max(191)).optional(),
  password: z.string().superRefine((value, context) => {
    const byteLength = Buffer.byteLength(value, 'utf8');
    if (byteLength < 12 || byteLength > 72) {
      context.addIssue({ code: 'custom', message: 'Mật khẩu phải dài từ 12 đến 72 byte UTF-8.' });
    }
  }),
  roles: z.array(z.enum(RoleCode)),
});
const managedRolesSchema = z.object({
  roles: z.array(z.enum([RoleCode.PARISH_ADMIN, RoleCode.APPGLV_ADMIN, RoleCode.TEACHER])).min(1).max(3),
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

securityRouter.post('/users', authorizeRole(RoleCode.SUPER_ADMIN), asyncHandler(async (request, response) => {
  const input = createUserSchema.parse(request.body);
  const roles = [...new Set(input.roles)];
  if (roles.includes(RoleCode.SUPER_ADMIN)) {
    throw new ApiError(409, 'SUPER_ADMIN_INVARIANT', 'Không thể tạo hoặc cấp vai trò Super Admin cho tài khoản khác.');
  }
  managedRolesSchema.parse({ roles });
  const passwordHash = await bcrypt.hash(input.password, 12);
  try {
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          username: input.username,
          displayName: input.displayName,
          email: input.email,
          passwordHash,
          roleAssignments: { create: roles.map((code) => ({ role: { connect: { code } }, assignedBy: request.auth!.userId })) },
        },
        include: includeAccess,
      });
      await tx.auditLog.create({ data: { actorId: request.auth!.userId, action: 'USER_CREATED', entityType: 'user', entityId: created.id, metadata: { roles }, ipAddress: request.ip } });
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
    if (desired.includes(RoleCode.SUPER_ADMIN) && !currentRoles.includes(RoleCode.SUPER_ADMIN)) {
      throw new ApiError(409, 'SUPER_ADMIN_INVARIANT', 'Không thể tạo hoặc cấp vai trò Super Admin cho tài khoản khác.');
    }
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
