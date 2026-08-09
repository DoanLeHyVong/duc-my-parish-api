import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ApiError } from '../utils/api-error.js';

export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(new ApiError(401, 'Cần đăng nhập quản trị'));
  try {
    const payload = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET) as {
      sub: string;
      username?: string;
    };
    req.admin = { id: Number(payload.sub), username: payload.username };
    next();
  } catch {
    next(new ApiError(401, 'Phiên đăng nhập không hợp lệ'));
  }
};
