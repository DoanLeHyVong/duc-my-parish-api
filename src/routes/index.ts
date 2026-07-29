import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate.middleware.js';
import { adminRouter } from '../modules/admin/admin.route.js';
import { authRouter } from '../modules/auth/auth.route.js';
import { mediaRouter } from '../modules/media/media.route.js';
import { publicRouter } from '../modules/public/public.route.js';

export const apiRouter = Router();
apiRouter.get('/health', (_req, res) =>
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() }, message: 'API hoạt động' }),
);
apiRouter.use('/public', publicRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/admin/media', authenticate, mediaRouter);
apiRouter.use('/admin', authenticate, adminRouter);
