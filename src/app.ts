import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { errorMiddleware } from './middlewares/error.middleware.js';
import { notFoundMiddleware } from './middlewares/not-found.middleware.js';
import { apiLimiter } from './middlewares/rate-limit.middleware.js';
import { apiRouter } from './routes/index.js';

export const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(pinoHttp({ logger }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/api/v1', apiLimiter, apiRouter);

const openapi = {
  openapi: '3.0.3',
  info: { title: 'Giáo xứ Đức Mỹ API', version: '1.0.0' },
  servers: [{ url: `http://localhost:${env.PORT}/api/v1` }],
  paths: {
    '/health': { get: { summary: 'Health check', responses: { '200': { description: 'OK' } } } },
    '/public/home': { get: { summary: 'Dữ liệu trang chủ', responses: { '200': { description: 'OK' } } } },
    '/public/posts': { get: { summary: 'Danh sách bài viết', responses: { '200': { description: 'OK' } } } },
    '/auth/login': { post: { summary: 'Đăng nhập quản trị', responses: { '200': { description: 'OK' } } } },
  },
};
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapi));
app.use(notFoundMiddleware);
app.use(errorMiddleware);
