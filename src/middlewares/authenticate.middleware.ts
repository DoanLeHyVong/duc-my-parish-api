import type { RequestHandler } from 'express';
import { prisma } from '../config/prisma.js';
import { verifyAccessToken } from '../lib/jwt.js';
import { ApiError } from '../utils/api-error.js';

export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const [scheme, token] = req.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) throw new ApiError(401, 'Cần đăng nhập để tiếp tục');
    const claims = verifyAccessToken(token);
    const user = await prisma.user.findUnique({
      where: { id: claims.sub },
      include: {
        roleAssignments: {
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        },
      },
    });
    if (!user || !user.isActive || user.deletedAt || user.authVersion !== claims.av) {
      throw new ApiError(401, 'Phiên đăng nhập không còn hợp lệ');
    }
    const roles = user.roleAssignments.map((assignment) => assignment.role.code);
    const permissions = [...new Set(user.roleAssignments.flatMap((assignment) =>
      assignment.role.permissions.map((item) => item.permission.code),
    ))];
    req.auth = { userId: user.id, roles, permissions, authVersion: user.authVersion };
    if (user.legacyParishAdminId !== null) {
      req.admin = { id: user.legacyParishAdminId, userId: user.id, username: user.username };
    }
    next();
  } catch (error) {
    next(error instanceof ApiError ? error : new ApiError(401, 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn'));
  }
};
