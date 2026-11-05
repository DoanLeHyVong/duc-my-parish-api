import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { loginLimiter, refreshLimiter } from '../../middlewares/rate-limit.middleware.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { authController } from './auth.controller.js';

export const authRouter = Router();
authRouter.post('/login', loginLimiter, asyncHandler(authController.login));
authRouter.post('/refresh', refreshLimiter, asyncHandler(authController.refresh));
authRouter.post('/logout', authenticate, asyncHandler(authController.logout));
authRouter.get('/me', authenticate, asyncHandler(authController.me));
authRouter.patch('/me', authenticate, asyncHandler(authController.updateProfile));
authRouter.post('/change-password', authenticate, asyncHandler(authController.changePassword));
