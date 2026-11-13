import { defineConfig } from 'vitest/config';

// CMS unit tests use mocked Prisma; they must not run the database-mutating global setup.
export default defineConfig({ test: { environment: 'node', include: ['tests/cms.unit.test.ts'] } });
