// Load and normalize environment variables used across the app.

const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function parseIntEnv(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return fallback;
}

function parseList(value) {
  if (!value || !String(value).trim()) {
    return [];
  }

  const items = [];
  for (const part of String(value).split(',')) {
    const trimmed = part.trim();
    if (trimmed) {
      items.push(trimmed);
    }
  }
  return items;
}

// Always compare procedures in lowercase schema.name form.
function normalizeProcedureName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.includes('.')) {
    const parts = trimmed.split('.');
    const schema = parts[0];
    const rest = parts.slice(1).join('.');
    return `${schema}.${rest}`.toLowerCase();
  }

  return `dbo.${trimmed}`.toLowerCase();
}

const env = {
  port: parseIntEnv(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: (process.env.NODE_ENV || 'development') === 'production',

  geminiApiKey: process.env.GEMINI_API_KEY || '',
  // gemini-flash-latest can be slow/overloaded and trip the app timeout.
  // gemini-2.5-flash is a stable, fast default for structured JSON calls.
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  geminiTimeoutMs: parseIntEnv(process.env.GEMINI_TIMEOUT_MS, 90000),
  // Limited retries for transient Gemini failures only (429/503/504).
  geminiMaxRetries: parseIntEnv(process.env.GEMINI_MAX_RETRIES, 1),

  // Preferred names: SQL_*. Optional DB_* aliases accepted for local setup docs.
  sql: {
    server: process.env.SQL_SERVER || process.env.DB_SERVER || '',
    port: parseIntEnv(process.env.SQL_PORT || process.env.DB_PORT, 1433),
    database: process.env.SQL_DATABASE || process.env.DB_NAME || '',
    user: process.env.SQL_USER || process.env.DB_USER || '',
    password: process.env.SQL_PASSWORD || process.env.DB_PASSWORD || '',
    encrypt: parseBool(process.env.SQL_ENCRYPT, true),
    trustServerCertificate: parseBool(process.env.SQL_TRUST_SERVER_CERTIFICATE, false),
    connectionTimeoutMs: parseIntEnv(process.env.SQL_CONNECTION_TIMEOUT_MS, 15000),
    requestTimeoutMs: parseIntEnv(process.env.SQL_REQUEST_TIMEOUT_MS, 30000),
  },

  allowedProceduresRaw: parseList(process.env.ALLOWED_PROCEDURES),
  allowedProcedures: parseList(process.env.ALLOWED_PROCEDURES).map(normalizeProcedureName),
  metadataCacheTtlMs: parseIntEnv(process.env.METADATA_CACHE_TTL_MS, 5 * 60 * 1000),
  procedureResultMaxRows: parseIntEnv(process.env.PROCEDURE_RESULT_MAX_ROWS, 500),
  businessRulesJson: process.env.BUSINESS_RULES_JSON || '',

  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  requestBodyLimit: process.env.REQUEST_BODY_LIMIT || '100kb',
  rateLimitWindowMs: parseIntEnv(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
  rateLimitMax: parseIntEnv(process.env.RATE_LIMIT_MAX, 120),

  mcpServerUrl: process.env.MCP_SERVER_URL || 'http://127.0.0.1:3001/mcp',
  mcpServerPort: parseIntEnv(process.env.MCP_SERVER_PORT, 3001),
  mcpAuthToken: process.env.MCP_AUTH_TOKEN || '',
  mcpBindHost: process.env.MCP_BIND_HOST || '127.0.0.1',

  apiAuthToken: process.env.API_AUTH_TOKEN || '',

  // Development-only fake SQL Server. Never enable automatically on connection failure.
  mockDatabase: parseBool(process.env.MOCK_DATABASE, false),
};

// MCP SDK default callTool timeout is 60s, which is shorter than Gemini (90s) + retry.
// Prefer an explicit MCP_TOOL_TIMEOUT_MS; otherwise derive a bounded value from Gemini settings.
function resolveMcpToolTimeoutMs() {
  const configured = parseIntEnv(process.env.MCP_TOOL_TIMEOUT_MS, 0);
  if (configured > 0) {
    return configured;
  }

  const geminiAttempts = 1 + Math.max(0, env.geminiMaxRetries);
  // Per attempt: SDK timeout + app race buffer (5s) + small MCP/tool overhead.
  const perAttemptMs = env.geminiTimeoutMs + 5000 + 10000;
  return geminiAttempts * perAttemptMs;
}

env.mcpToolTimeoutMs = resolveMcpToolTimeoutMs();

function assertSqlConfigured() {
  // Mock mode does not need real SQL credentials.
  if (env.mockDatabase) {
    return [];
  }

  const missing = [];
  if (!env.sql.server) missing.push('SQL_SERVER');
  if (!env.sql.database) missing.push('SQL_DATABASE');
  if (!env.sql.user) missing.push('SQL_USER');
  if (!env.sql.password) missing.push('SQL_PASSWORD');
  return missing;
}

// Fail loudly if someone tries to run fake data in production.
function assertMockModeSafe() {
  if (env.mockDatabase && env.isProduction) {
    const error = new Error(
      'MOCK_DATABASE=true is not allowed when NODE_ENV=production. Disable mock mode or use a non-production environment.'
    );
    error.code = 'MOCK_DATABASE_FORBIDDEN_IN_PRODUCTION';
    error.status = 500;
    throw error;
  }
}

function getDatabaseModeLabel() {
  if (env.mockDatabase) {
    return 'MOCK (no SQL Server connection; fake metadata/execution only)';
  }
  return 'REAL SQL Server';
}

function assertAllowlistConfigured() {
  if (!env.allowedProcedures.length) {
    return ['ALLOWED_PROCEDURES'];
  }
  return [];
}

function getStartupWarnings() {
  const warnings = [];

  if (env.mockDatabase) {
    warnings.push('MOCK_DATABASE=true — using mocked SQL responses. No real database queries will run.');
  }
  if (!env.geminiApiKey) {
    warnings.push('GEMINI_API_KEY is not set; interpret and AI-assisted validation will be unavailable.');
  }
  if (!env.mcpAuthToken) {
    warnings.push('MCP_AUTH_TOKEN is not set; MCP server will accept unauthenticated local connections.');
  }
  if (env.isProduction && !env.apiAuthToken) {
    warnings.push('API_AUTH_TOKEN is not set in production; protect /api/execute before public deployment.');
  }
  if (env.isProduction && env.sql.trustServerCertificate) {
    warnings.push('SQL_TRUST_SERVER_CERTIFICATE=true is unsafe in production.');
  }

  return warnings;
}

module.exports = {
  env,
  normalizeProcedureName,
  assertSqlConfigured,
  assertAllowlistConfigured,
  assertMockModeSafe,
  getDatabaseModeLabel,
  getStartupWarnings,
};
