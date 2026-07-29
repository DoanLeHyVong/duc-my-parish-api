import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { authLimiter } from '../../middlewares/rate-limit.middleware.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { authController } from './auth.controller.js';

export const authRouter = Router();
authRouter.post('/login', authLimiter, asyncHandler(authController.login));
authRouter.post('/refresh', authLimiter, asyncHandler(authController.refresh));
authRouter.post('/logout', authenticate, asyncHandler(authController.logout));
authRouter.get('/me', authenticate, asyncHandler(authController.me));
