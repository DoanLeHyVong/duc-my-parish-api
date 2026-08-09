import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/api-error.js';
import type { LoginInput } from './auth.type.js';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const safeAdmin = (admin: { id: number; fullName: string; username: string | null; email: string; isActive: boolean }) => ({
  id: admin.id,
  fullName: admin.fullName,
  username: admin.username,
  email: admin.email,
  isActive: admin.isActive,
});

const tokensFor = (admin: { id: number; username: string | null }) => ({
  accessToken: jwt.sign({ username: admin.username }, env.JWT_ACCESS_SECRET, {
    subject: String(admin.id),
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as any,
  }),
  refreshToken: jwt.sign({ nonce: randomUUID() }, env.JWT_REFRESH_SECRET, {
    subject: String(admin.id),
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as any,
  }),
});

export const authService = {
  async login(input: LoginInput, ipAddress?: string) {
    const username = input.username.trim().toLowerCase();
    const admin = await prisma.admin.findUnique({ where: { username } });
    if (!admin || !admin.isActive || admin.deletedAt) throw new ApiError(401, 'Tên đăng nhập hoặc mật khẩu sai');
    if (!(await bcrypt.compare(input.password, admin.passwordHash)))
      throw new ApiError(401, 'Tên đăng nhập hoặc mật khẩu sai');
    const tokens = tokensFor(admin);
    await prisma.$transaction([
      prisma.admin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } }),
      prisma.adminSession.create({
        data: {
          adminId: admin.id,
          tokenHash: hashToken(tokens.refreshToken),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
        },
      }),
      prisma.auditLog.create({
        data: { adminId: admin.id, action: 'LOGIN', ipAddress },
      }),
    ]);
    return { ...tokens, admin: safeAdmin(admin) };
  },
  async refresh(refreshToken: string) {
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as jwt.JwtPayload;
    } catch {
      throw new ApiError(401, 'Refresh token không hợp lệ');
    }
    const session = await prisma.adminSession.findFirst({
      where: {
        adminId: Number(payload.sub),
        tokenHash: hashToken(refreshToken),
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { admin: true },
    });
    if (!session || !session.admin.isActive) throw new ApiError(401, 'Phiên đã hết hạn');
    const tokens = tokensFor(session.admin);
    await prisma.$transaction([
      prisma.adminSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      }),
      prisma.adminSession.create({
        data: {
          adminId: session.adminId,
          tokenHash: hashToken(tokens.refreshToken),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
        },
      }),
    ]);
    return { ...tokens, admin: safeAdmin(session.admin) };
  },
  async logout(refreshToken?: string, adminId?: number, ipAddress?: string) {
    if (refreshToken) {
      await prisma.adminSession.updateMany({
        where: { tokenHash: hashToken(refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    if (adminId) {
      await prisma.auditLog.create({
        data: { adminId, action: 'LOGOUT', ipAddress },
      });
    }
  },
  async me(adminId: number) {
    const admin = await prisma.admin.findUnique({
      where: { id: adminId },
      select: { id: true, fullName: true, username: true, email: true, isActive: true, lastLoginAt: true },
    });
    if (!admin) throw new ApiError(404, 'Không tìm thấy quản trị viên');
    return admin;
  },
};
