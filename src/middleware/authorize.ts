import type { Request, RequestHandler } from 'express';
import type { RoleCode } from '../generated/prisma/enums.js';
import { ApiError } from '../lib/api-error.js';

export const Permission = {
  PARISH_MANAGE: 'parish.manage',
  APPGLV_MANAGE: 'appglv.manage',
  APPGLV_TEACH: 'appglv.teach',
  POLICIES_MANAGE: 'policies.manage',
  SECURITY_MANAGE: 'security.manage',
} as const;

export function authorize(...permissions: string[]): RequestHandler {
  return (request, _response, next) => {
    if (!request.auth || !permissions.some((permission) => request.auth!.permissions.includes(permission))) {
      next(new ApiError(403, 'FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.'));
      return;
    }
    next();
  };
}

export function authorizeRole(...roles: RoleCode[]): RequestHandler {
  return (request, _response, next) => {
    if (!request.auth || !roles.some((role) => request.auth!.roles.includes(role))) {
      next(new ApiError(403, 'FORBIDDEN', 'Vai trò hiện tại không được phép thực hiện thao tác này.'));
      return;
    }
    next();
  };
}

export function isTeacherScope(request: Request): boolean {
  return request.originalUrl.startsWith('/api/v1/teacher');
}

export function hasRole(request: Request, role: RoleCode): boolean {
  return request.auth?.roles.includes(role) ?? false;
}

