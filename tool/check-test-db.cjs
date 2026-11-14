const fs = require('node:fs');
const mariadb = require('mariadb');
const env = require('dotenv').parse(fs.readFileSync('.env'));
const url = new URL(env.DATABASE_URL);
mariadb.createConnection({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
}).then(async (connection) => {
  try {
    const rows = await connection.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', ['appglv_unified_test']);
    console.log(rows.length ? 'TEST_DB_EXISTS' : 'TEST_DB_ABSENT');
    if (rows.length) {
      const tables = await connection.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', ['appglv_unified_test']);
      console.log(`TEST_TABLE_COUNT=${tables.length}`);
      if (tables.some((table) => table.TABLE_NAME === 'policies')) {
        const policyCounts = await connection.query('SELECT COUNT(*) AS count FROM appglv_unified_test.policies');
        console.log(`TEST_POLICY_COUNT=${policyCounts[0].count}`);
        const columns = await connection.query('SELECT COLUMN_NAME, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION', ['appglv_unified_test', 'policies']);
        console.log('POLICY_COLUMNS=' + columns.map((row) => `${row.COLUMN_NAME}:${row.IS_NULLABLE}`).join(','));
      }
      const userCount = await connection.query('SELECT COUNT(*) AS count FROM appglv_unified_test.users');
      console.log(`TEST_USER_COUNT=${userCount[0].count}`);
    }
  } finally {
    await connection.end();
  }
}).catch((error) => {
  console.error('TEST_DB_CHECK_FAILED', error.code || error.name);
  process.exitCode = 1;
});
