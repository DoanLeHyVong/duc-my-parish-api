import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { signAccessToken } from '../../lib/jwt.js';
import { ApiError } from '../../utils/api-error.js';
import type { RoleCode } from '../../generated/prisma/enums.js';
import type { LoginInput } from './auth.type.js';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const rolePriority: RoleCode[] = ['SUPER_ADMIN', 'APPGLV_ADMIN', 'TEACHER', 'PARISH_ADMIN'];
const userInclude = {
  roleAssignments: {
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  },
} as const;

async function loadUser(id: string) {
  return prisma.user.findUnique({ where: { id }, include: userInclude });
}
type IncludedUser = Awaited<ReturnType<typeof loadUser>>;

function roleData(user: NonNullable<IncludedUser>) {
  const roles = user.roleAssignments.map((assignment) => assignment.role.code);
  const permissions = [...new Set(user.roleAssignments.flatMap((assignment) =>
    assignment.role.permissions.map((item) => item.permission.code),
  ))];
  const role = rolePriority.find((candidate) => roles.includes(candidate)) ?? roles[0];
  return { roles, permissions, role };
}
function safeUser(user: NonNullable<IncludedUser>) {
  return { id: user.id, username: user.username, displayName: user.displayName, email: user.email, isActive: user.isActive, ...roleData(user) };
}
function legacyAdmin(user: NonNullable<IncludedUser>) {
  return { id: user.legacyParishAdminId, fullName: user.displayName, username: user.username, email: user.email, isActive: user.isActive, roles: roleData(user).roles, permissions: roleData(user).permissions };
}
function tokensFor(user: NonNullable<IncludedUser>) {
  return {
    accessToken: signAccessToken({ sub: user.id, av: user.authVersion }),
    refreshToken: jwt.sign({ nonce: randomUUID(), av: user.authVersion }, env.JWT_REFRESH_SECRET, {
      subject: user.id,
      expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'],
      issuer: 'duc-my-unified-api',
      audience: 'duc-my-clients',
    }),
  };
}

export const authService = {
  async login(input: LoginInput, ipAddress?: string) {
    const candidate = await prisma.user.findUnique({ where: { username: input.username }, include: userInclude });
    const fallbackHash = '$2b$12$qRGWOygQHq0JdsVDqceUve0rjj04H.GWqcinoF.y309gq.JWFQlHW';
    const valid = await bcrypt.compare(input.password, candidate?.passwordHash ?? fallbackHash);
    if (!candidate || !valid || !candidate.isActive || candidate.deletedAt) throw new ApiError(401, 'Tên đăng nhập hoặc mật khẩu sai');
    const tokens = tokensFor(candidate);
    await prisma.$transaction([
      prisma.user.update({ where: { id: candidate.id }, data: { lastLoginAt: new Date() } }),
      prisma.authSession.create({ data: { userId: candidate.id, tokenHash: hashToken(tokens.refreshToken), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000) } }),
      prisma.auditLog.create({ data: { actorId: candidate.id, action: 'LOGIN', ipAddress } }),
    ]);
    return { ...tokens, user: safeUser(candidate), admin: legacyAdmin(candidate) };
  },
  async refresh(refreshToken: string) {
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET, { issuer: 'duc-my-unified-api', audience: 'duc-my-clients' }) as jwt.JwtPayload;
    } catch {
      throw new ApiError(401, 'Refresh token không hợp lệ');
    }
    const session = await prisma.authSession.findFirst({ where: { userId: String(payload.sub), tokenHash: hashToken(refreshToken), revokedAt: null, expiresAt: { gt: new Date() } } });
    const user = session ? await loadUser(session.userId) : null;
    if (!session || !user || !user.isActive || user.deletedAt || payload.av !== user.authVersion) throw new ApiError(401, 'Phiên đã hết hạn');
    const tokens = tokensFor(user);
    await prisma.$transaction([
      prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } }),
      prisma.authSession.create({ data: { userId: user.id, tokenHash: hashToken(tokens.refreshToken), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000) } }),
    ]);
    return { ...tokens, user: safeUser(user), admin: legacyAdmin(user) };
  },
  async logout(refreshToken?: string, userId?: string, ipAddress?: string) {
    if (refreshToken) await prisma.authSession.updateMany({ where: { tokenHash: hashToken(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
    if (userId) await prisma.auditLog.create({ data: { actorId: userId, action: 'LOGOUT', ipAddress } });
  },
  async me(userId: string) {
    const user = await loadUser(userId);
    if (!user) throw new ApiError(404, 'Không tìm thấy người dùng');
    return { ...safeUser(user), user: safeUser(user), admin: legacyAdmin(user) };
  },
  async updateProfile(userId: string, displayName: string) {
    await prisma.user.update({ where: { id: userId }, data: { displayName } });
    return this.me(userId);
  },
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw new ApiError(422, 'Mật khẩu hiện tại không đúng');
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { passwordHash, authVersion: { increment: 1 } } }),
      prisma.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
      prisma.auditLog.create({ data: { actorId: userId, action: 'PASSWORD_CHANGED' } }),
    ]);
  },
};
