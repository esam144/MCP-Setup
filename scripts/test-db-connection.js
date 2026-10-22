// Diagnostic: connect to SQL Server and confirm the target database name.
// Usage: npm run test:db
// Does not log passwords or full connection strings.

const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  // Load env after dotenv so MOCK_DATABASE / SQL_* are visible.
  const { env, assertSqlConfigured, getDatabaseModeLabel } = require('../src/config/env');
  const { getPool, closePool, isMockDatabase } = require('../src/config/database');

  console.log(`[test:db] Database mode: ${getDatabaseModeLabel()}`);

  if (isMockDatabase()) {
    console.error(
      '[test:db] MOCK_DATABASE=true. Set MOCK_DATABASE=false in .env to test a real SQL Server connection.'
    );
    process.exitCode = 1;
    return;
  }

  const missing = assertSqlConfigured();
  if (missing.length > 0) {
    console.error(`[test:db] Missing SQL configuration: ${missing.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `[test:db] Connecting to ${env.sql.server}:${env.sql.port} / database=${env.sql.database} / user=${env.sql.user}`
  );

  let pool;
  try {
    pool = await getPool();
    const result = await pool
      .request()
      .query(`SELECT DB_NAME() AS databaseName, @@SERVERNAME AS serverName;`);

    const row = result.recordset && result.recordset[0];
    if (!row) {
      throw new Error('Query returned no rows');
    }

    console.log(`[test:db] databaseName=${row.databaseName}`);
    console.log(`[test:db] serverName=${row.serverName}`);

    if (String(row.databaseName) !== String(env.sql.database)) {
      console.error(
        `[test:db] FAIL: expected database "${env.sql.database}" but DB_NAME() returned "${row.databaseName}"`
      );
      process.exitCode = 1;
      return;
    }

    console.log('[test:db] OK — connected and database name matches.');
  } catch (error) {
    console.error(`[test:db] FAIL: ${error.message}`);
    if (error.code) {
      console.error(`[test:db] code=${error.code}`);
    }
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(`[test:db] Unexpected error: ${error.message}`);
  process.exitCode = 1;
});
