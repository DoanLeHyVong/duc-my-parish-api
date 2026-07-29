import rateLimit from 'express-rate-limit';

export const apiLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 500 });
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  message: { success: false, message: 'Thử đăng nhập quá nhiều lần' },
});
