import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/prisma.js';

const server = app.listen(env.PORT, () => {
  logger.info(`Giáo xứ Đức Mỹ API: http://localhost:${env.PORT}/api/v1`);
  logger.info(`Swagger: http://localhost:${env.PORT}/api-docs`);
});

const shutdown = async () => {
  server.close();
  await prisma.$disconnect();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
