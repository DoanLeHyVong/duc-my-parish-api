import { Prisma, RoleCode } from '../../generated/prisma/client.js';
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { ApiError } from '../../lib/api-error.js';
import { hashPassword } from '../../lib/password.js';
import { authenticate } from '../../middleware/auth.js';
import { authorize, Permission } from '../../middleware/authorize.js';
import {
  createTeacherSchema,
  listTeachersSchema,
  lockTeacherSchema,
  resetTeacherPasswordSchema,
  teacherIdSchema,
  updateTeacherSchema,
} from './user.schemas.js';

export const teacherRouter = Router();
teacherRouter.use(authenticate, authorize(Permission.APPGLV_MANAGE));

type TeacherShape = { id: string; username: string; displayName: string; isActive: boolean; createdAt: Date; updatedAt: Date };
function safeTeacher(user: TeacherShape) {
  return { ...user, role: RoleCode.TEACHER, roles: [RoleCode.TEACHER] };
}

async function ensureTeacher(id: string) {
  const teacher = await prisma.user.findFirst({
    where: { id, roleAssignments: { some: { role: { code: RoleCode.TEACHER } } } },
  });
  if (!teacher) throw new ApiError(404, 'TEACHER_NOT_FOUND', 'Không tìm thấy tài khoản Giáo lý viên.');
  return teacher;
}

function rethrowConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new ApiError(409, 'USERNAME_EXISTS', 'Tên đăng nhập đã được sử dụng.');
  }
  throw error;
}

teacherRouter.get('/', asyncHandler(async (request, response) => {
  const query = listTeachersSchema.parse(request.query);
  const where: Prisma.UserWhereInput = {
    roleAssignments: { some: { role: { code: RoleCode.TEACHER } } },
    ...(query.status === 'active' ? { isActive: true } : query.status === 'locked' ? { isActive: false } : {}),
    ...(query.search ? { OR: [{ username: { contains: query.search } }, { displayName: { contains: query.search } }] } : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.user.findMany({ where, orderBy: { displayName: 'asc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
    prisma.user.count({ where }),
  ]);
  response.json({ data: { items: items.map(safeTeacher), page: query.page, limit: query.limit, total } });
}));

teacherRouter.post('/', asyncHandler(async (request, response) => {
  const input = createTeacherSchema.parse(request.body);
  const passwordHash = await hashPassword(input.password);
  try {
    const teacher = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          username: input.username,
          displayName: input.displayName,
          passwordHash,
          roleAssignments: { create: { role: { connect: { code: RoleCode.TEACHER } }, assignedBy: request.auth!.userId } },
        },
      });
      await tx.auditLog.create({ data: { actorId: request.auth!.userId, action: 'TEACHER_CREATED', entityType: 'user', entityId: created.id } });
      return created;
    });
    response.status(201).json({ data: safeTeacher(teacher) });
  } catch (error) {
    rethrowConflict(error);
  }
}));

teacherRouter.patch('/:id', asyncHandler(async (request, response) => {
  const { id } = teacherIdSchema.parse(request.params);
  const input = updateTeacherSchema.parse(request.body);
  await ensureTeacher(id);
  try {
    const teacher = await prisma.user.update({ where: { id }, data: input });
    response.json({ data: safeTeacher(teacher) });
  } catch (error) {
    rethrowConflict(error);
  }
}));

teacherRouter.post('/:id/lock', asyncHandler(async (request, response) => {
  const { id } = teacherIdSchema.parse(request.params);
  const { locked } = lockTeacherSchema.parse(request.body);
  await ensureTeacher(id);
  const teacher = await prisma.$transaction(async (tx) => {
    const changed = await tx.user.update({ where: { id }, data: { isActive: !locked, authVersion: { increment: 1 } } });
    await tx.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.auditLog.create({ data: { actorId: request.auth!.userId, action: locked ? 'USER_LOCKED' : 'USER_UNLOCKED', entityType: 'user', entityId: id } });
    return changed;
  });
  response.json({ data: safeTeacher(teacher) });
}));

teacherRouter.post('/:id/reset-password', asyncHandler(async (request, response) => {
  const { id } = teacherIdSchema.parse(request.params);
  const { newPassword } = resetTeacherPasswordSchema.parse(request.body);
  await ensureTeacher(id);
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { passwordHash, authVersion: { increment: 1 } } }),
    prisma.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.auditLog.create({ data: { actorId: request.auth!.userId, action: 'PASSWORD_RESET', entityType: 'user', entityId: id } }),
  ]);
  response.json({ data: { message: 'Đặt lại mật khẩu thành công. Các phiên cũ đã bị vô hiệu hóa.' } });
}));
