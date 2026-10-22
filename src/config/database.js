// Shared SQL Server connection pool.
// Call getPool() from services; do not create a new connection per request.
// When MOCK_DATABASE=true, real connections are blocked on purpose.

const sql = require('mssql');
const { env, assertSqlConfigured } = require('./env');

let poolPromise = null;
let realConnectAttempted = false;

function buildConfig() {
  const missing = assertSqlConfigured();
  if (missing.length > 0) {
    const error = new Error(`Missing SQL configuration: ${missing.join(', ')}`);
    error.code = 'SQL_CONFIG_MISSING';
    error.status = 503;
    throw error;
  }

  return {
    server: env.sql.server,
    port: env.sql.port,
    database: env.sql.database,
    user: env.sql.user,
    password: env.sql.password,
    options: {
      encrypt: env.sql.encrypt,
      trustServerCertificate: env.sql.trustServerCertificate,
      enableArithAbort: true,
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
    connectionTimeout: env.sql.connectionTimeoutMs,
    requestTimeout: env.sql.requestTimeoutMs,
  };
}

function isMockDatabase() {
  return Boolean(env.mockDatabase);
}

function wasRealConnectAttempted() {
  return realConnectAttempted;
}

async function getPool() {
  // Mock mode must never open a real SQL Server connection.
  if (env.mockDatabase) {
    const error = new Error(
      'getPool() was called while MOCK_DATABASE=true. Real SQL Server access is disabled in mock mode.'
    );
    error.code = 'MOCK_DATABASE_ACTIVE';
    error.status = 500;
    throw error;
  }

  if (poolPromise) {
    return poolPromise;
  }

  poolPromise = connectWithFriendlyError();
  return poolPromise;
}

async function connectWithFriendlyError() {
  realConnectAttempted = true;

  try {
    const pool = await new sql.ConnectionPool(buildConfig()).connect();
    return pool;
  } catch (cause) {
    // Clear so the next call can retry.
    // Important: a failed real connection does NOT enable mock mode.
    poolPromise = null;

    // Never include credentials; surface only a safe driver message fragment.
    const driverMessage =
      cause && cause.message ? String(cause.message).replace(/\s+/g, ' ').slice(0, 200) : 'unknown error';
    const error = new Error(`Failed to connect to SQL Server (${driverMessage})`);
    error.code = 'SQL_CONNECTION_FAILED';
    error.status = 503;
    error.cause = cause;
    throw error;
  }
}

async function closePool() {
  if (!poolPromise) {
    return;
  }

  try {
    const pool = await poolPromise;
    await pool.close();
  } catch {
    // Ignore close errors during shutdown.
  }

  poolPromise = null;
}

module.exports = {
  sql,
  getPool,
  closePool,
  buildConfig,
  isMockDatabase,
  wasRealConnectAttempted,
};
