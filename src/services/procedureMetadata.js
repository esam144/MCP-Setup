// Discovers stored procedure parameter metadata from SQL Server system views.
// Only allowlisted procedures are ever queried or returned.

const { getPool, sql, isMockDatabase } = require('../config/database');
const { env, normalizeProcedureName, assertAllowlistConfigured } = require('../config/env');
const { getMockProcedureMetadata } = require('../mocks/mockDatabase');

// Simple in-memory cache: procedureName -> { value, expiresAt }
const cache = new Map();

function ensureAllowlist() {
  const missing = assertAllowlistConfigured();
  if (missing.length > 0) {
    const error = new Error(
      'ALLOWED_PROCEDURES is not configured. Set a comma-separated allowlist of schema-qualified procedure names.'
    );
    error.code = 'ALLOWLIST_NOT_CONFIGURED';
    error.status = 503;
    throw error;
  }
}

function assertAllowedProcedure(procedureName) {
  ensureAllowlist();
  const normalized = normalizeProcedureName(procedureName);

  if (!env.allowedProcedures.includes(normalized)) {
    const error = new Error(`Procedure is not on the allowlist: ${procedureName}`);
    error.code = 'PROCEDURE_NOT_ALLOWED';
    error.status = 403;
    throw error;
  }

  return normalized;
}

function splitQualifiedName(qualified) {
  const normalized = normalizeProcedureName(qualified);
  const parts = normalized.split('.');
  const schema = parts[0];
  const name = parts.slice(1).join('.');

  return {
    schema,
    name,
    qualified: `${schema}.${name}`,
  };
}

function mapParameterRow(row) {
  return {
    name: row.parameter_name,
    ordinal: row.parameter_id,
    sqlType: row.type_name,
    maxLength: row.max_length,
    precision: row.precision,
    scale: row.scale,
    isOutput: Boolean(row.is_output),
    hasDefaultValue: Boolean(row.has_default_value),
    defaultValue: row.default_value ?? null,
    isNullable: true,
  };
}

async function fetchProcedureMetadata(procedureName) {
  const allowed = assertAllowedProcedure(procedureName);

  // Development mock path — no SQL Server connection or queries.
  if (isMockDatabase()) {
    return getMockProcedureMetadata(allowed);
  }

  const { schema, name, qualified } = splitQualifiedName(allowed);

  const pool = await getPool();
  const request = pool.request();

  // Use bound parameters for the lookup values (never concatenate untrusted input).
  request.input('schemaName', sql.NVarChar(128), schema);
  request.input('procedureName', sql.NVarChar(128), name);

  const result = await request.query(`
    SELECT
      s.name AS schema_name,
      p.name AS procedure_name,
      pr.name AS parameter_name,
      pr.parameter_id,
      t.name AS type_name,
      pr.max_length,
      pr.precision,
      pr.scale,
      pr.is_output,
      pr.has_default_value,
      pr.default_value
    FROM sys.procedures AS p
    INNER JOIN sys.schemas AS s ON p.schema_id = s.schema_id
    LEFT JOIN sys.parameters AS pr ON pr.object_id = p.object_id
    LEFT JOIN sys.types AS t ON pr.user_type_id = t.user_type_id
    WHERE LOWER(s.name) = @schemaName
      AND LOWER(p.name) = @procedureName
    ORDER BY pr.parameter_id;
  `);

  if (!result.recordset.length) {
    const error = new Error(`Stored procedure not found: ${qualified}`);
    error.code = 'PROCEDURE_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  const first = result.recordset[0];
  const parameters = [];
  for (const row of result.recordset) {
    if (row.parameter_name) {
      parameters.push(mapParameterRow(row));
    }
  }

  return {
    schema: first.schema_name,
    name: first.procedure_name,
    qualifiedName: `${first.schema_name}.${first.procedure_name}`,
    normalizedName: qualified,
    parameters,
  };
}

function getCacheEntry(key) {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }

  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

async function getProcedureMetadata(procedureName, options = {}) {
  const refresh = Boolean(options.refresh);
  const allowed = assertAllowedProcedure(procedureName);

  if (!refresh) {
    const cached = getCacheEntry(allowed);
    if (cached) {
      return cached;
    }
  }

  const metadata = await fetchProcedureMetadata(allowed);
  cache.set(allowed, {
    value: metadata,
    expiresAt: Date.now() + env.metadataCacheTtlMs,
  });
  return metadata;
}

function listAllowedProcedures() {
  ensureAllowlist();

  const list = [];
  for (const raw of env.allowedProceduresRaw) {
    const normalized = normalizeProcedureName(raw);
    const split = splitQualifiedName(normalized);
    const display = raw.includes('.') ? raw : `dbo.${raw}`;
    const displayParts = display.split('.');
    const displaySchema = displayParts[0];
    const displayName = displayParts.slice(1).join('.');

    list.push({
      schema: displaySchema || split.schema,
      name: displayName || split.name,
      qualifiedName: display,
      normalizedName: normalized,
    });
  }

  return list;
}

function clearMetadataCache() {
  cache.clear();
}

module.exports = {
  listAllowedProcedures,
  getProcedureMetadata,
  assertAllowedProcedure,
  clearMetadataCache,
  normalizeProcedureName,
  splitQualifiedName,
  ensureAllowlist,
};
