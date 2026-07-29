import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { ApiError } from '../utils/api-error.js';

export const errorMiddleware: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(422).json({
      success: false,
      message: 'Dữ liệu không hợp lệ',
      errors: error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }
  const status = error instanceof ApiError ? error.statusCode : 500;
  if (status === 500) logger.error({ err: error }, 'Unhandled request error');
  res.status(status).json({
    success: false,
    message: error instanceof Error ? error.message : 'Lỗi máy chủ',
    ...(error instanceof ApiError && error.errors ? { errors: error.errors } : {}),
    ...(env.NODE_ENV !== 'production' && status === 500
      ? { debug: error instanceof Error ? error.stack : undefined }
      : {}),
  });
};
