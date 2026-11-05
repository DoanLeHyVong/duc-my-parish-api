import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { authenticate } from '../../middleware/auth.js';
import { authorize, Permission } from '../../middleware/authorize.js';

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const auditRouter = Router();
auditRouter.use(authenticate, authorize(Permission.PARISH_MANAGE, Permission.SECURITY_MANAGE));
auditRouter.get('/', asyncHandler(async (request, response) => {
  const query = querySchema.parse(request.query);
  const [data, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: { actor: { select: { id: true, displayName: true, username: true } } },
    }),
    prisma.auditLog.count(),
  ]);
  response.json({ success: true, data, meta: { ...query, total, totalPages: Math.ceil(total / query.limit) } });
}));
