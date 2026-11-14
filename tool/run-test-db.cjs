// Runs only approved Prisma/test commands against the existing local test schema.
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const mariadb = require('mariadb');
const dotenv = require('dotenv');

const commands = {
  validate: ['npx.cmd', ['prisma', 'validate']],
  status: ['npx.cmd', ['prisma', 'migrate', 'status']],
  migrate: ['npx.cmd', ['prisma', 'migrate', 'deploy']],
  test: ['npm.cmd', ['test']],
};
const action = process.argv[2];
if (!Object.hasOwn(commands, action)) throw new Error('Only validate, status, migrate, and test are allowed.');
const local = dotenv.parse(fs.readFileSync('.env'));
const url = new URL(local.DATABASE_URL);
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol !== 'mysql:') {
  throw new Error('Refusing a nonlocal database host.');
}
url.pathname = '/appglv_unified_test';

async function main() {
  const connection = await mariadb.createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  });
  try {
    const result = await connection.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', ['appglv_unified_test']);
    if (result.length !== 1) throw new Error('Dedicated test database is missing.');
  } finally {
    await connection.end();
  }
  const [program, args] = commands[action];
  const onWindows = process.platform === 'win32';
  const child = spawnSync(onWindows ? (process.env.ComSpec || 'cmd.exe') : program, onWindows ? ['/d', '/s', '/c', [program, ...args].join(' ')] : args, {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url.toString(), NODE_ENV: 'test' },
    stdio: 'inherit',
  });
  if (child.error) throw child.error;
  process.exitCode = child.status ?? 1;
}
main().catch((error) => {
  console.error('Test database command blocked:', error.message);
  process.exitCode = 1;
});
