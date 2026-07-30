import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

export const apiLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 500 });

export const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.NODE_ENV === 'production' ? 10 : 100,
  skipSuccessfulRequests: true,
  message: { success: false, message: 'Thử đăng nhập quá nhiều lần' },
});

export const refreshLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.NODE_ENV === 'production' ? 60 : 500,
  skipSuccessfulRequests: true,
  message: { success: false, message: 'Làm mới phiên quá nhiều lần' },
});
