import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'prisma/config';

loadDotenv({ path: path.resolve(process.cwd(), '.env'), quiet: true });
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl || !databaseUrl.startsWith('mysql://')) {
  throw new Error('Prisma requires a non-placeholder MySQL DATABASE_URL.');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: { url: databaseUrl },
});
