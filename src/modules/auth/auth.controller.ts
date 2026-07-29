import type { Request, Response } from 'express';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/api-error.js';
import { ok } from '../../utils/response.js';
import { loginSchema } from './auth.schema.js';
import { authService } from './auth.service.js';

const cookieOptions = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SAME_SITE,
  domain: env.COOKIE_DOMAIN || undefined,
  path: '/api/v1/auth',
  maxAge: 7 * 24 * 60 * 60_000,
} as const;

export const authController = {
  async login(req: Request, res: Response) {
    const result = await authService.login(loginSchema.parse(req.body), req.ip);
    res.cookie('refreshToken', result.refreshToken, cookieOptions);
    return ok(res, { accessToken: result.accessToken, admin: result.admin }, 'Đăng nhập thành công');
  },
  async refresh(req: Request, res: Response) {
    const token = req.cookies.refreshToken;
    if (!token) throw new ApiError(401, 'Thiếu refresh token');
    const result = await authService.refresh(token);
    res.cookie('refreshToken', result.refreshToken, cookieOptions);
    return ok(res, { accessToken: result.accessToken, admin: result.admin });
  },
  async logout(req: Request, res: Response) {
    await authService.logout(req.cookies.refreshToken, req.admin?.id, req.ip);
    res.clearCookie('refreshToken', cookieOptions);
    return ok(res, null, 'Đăng xuất thành công');
  },
  async me(req: Request, res: Response) {
    return ok(res, await authService.me(req.admin!.id));
  },
};
