import { APP_TABLES, PARISH_TABLES, assertIsolated, closeAll, count, databaseConfig } from './migration-lib.js';

const parish = databaseConfig('PARISH_SOURCE_DATABASE_URL');
const app = databaseConfig('APPGLV_SOURCE_DATABASE_URL');
const target = databaseConfig('DATABASE_URL');
assertIsolated(parish, app, target);

const result: Record<string, { source: number; target: number; matches: boolean }> = {};
try {
  const [parishConnection, appConnection, targetConnection] = await Promise.all([parish.pool.getConnection(), app.pool.getConnection(), target.pool.getConnection()]);
  try {
    for (const table of APP_TABLES) {
      const source = await count(appConnection, table);
      const targetCount = await count(targetConnection, table);
      result[`appglv.${table}`] = { source, target: targetCount, matches: source === targetCount };
    }
    for (const table of PARISH_TABLES) {
      const source = await count(parishConnection, table);
      const targetCount = await count(targetConnection, table);
      result[`parish.${table}`] = { source, target: targetCount, matches: source === targetCount };
    }
  } finally {
    parishConnection.release();
    appConnection.release();
    targetConnection.release();
  }
} finally {
  await closeAll(parish, app, target);
}
console.log(JSON.stringify(result, null, 2));
if (Object.values(result).some((item) => !item.matches)) process.exitCode = 1;
