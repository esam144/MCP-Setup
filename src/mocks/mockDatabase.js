// Development-only mock SQL Server data.
// Edit MOCK_PROCEDURES below to change parameter schemas while testing without SQL Server.
//
// NOTE: Agent roster parameters below are MOCK placeholders. They are not claimed to
// match the real SQL Server procedure until live metadata is retrieved.

const { env, normalizeProcedureName } = require('../config/env');

function makeParam(name, sqlType, options = {}) {
  return {
    name: name.startsWith('@') ? name : `@${name}`,
    ordinal: options.ordinal || 0,
    sqlType,
    maxLength: options.maxLength != null ? options.maxLength : 0,
    precision: options.precision != null ? options.precision : 0,
    scale: options.scale != null ? options.scale : 0,
    isOutput: Boolean(options.isOutput),
    hasDefaultValue: Boolean(options.hasDefaultValue),
    defaultValue: options.defaultValue != null ? options.defaultValue : null,
    isNullable: options.isNullable !== false,
  };
}

/**
 * Easy-to-edit mock catalog.
 * Keys are normalized (lowercase schema.name).
 */
const MOCK_PROCEDURES = {
  'dbo.getloveableapilistings': {
    schema: 'dbo',
    name: 'GetLoveableAPIListings',
    qualifiedName: 'dbo.GetLoveableAPIListings',
    normalizedName: 'dbo.getloveableapilistings',
    parameters: [
      makeParam('listing_type', 'varchar', { ordinal: 1, maxLength: 50 }),
      makeParam('mls', 'varchar', { ordinal: 2, maxLength: 50 }),
      makeParam('propTypes', 'varchar', { ordinal: 3, maxLength: 200 }),
      makeParam('minBed', 'int', { ordinal: 4, precision: 10 }),
      makeParam('maxBed', 'int', { ordinal: 5, precision: 10 }),
      makeParam('minBath', 'decimal', { ordinal: 6, precision: 9, scale: 2 }),
      makeParam('maxBath', 'decimal', { ordinal: 7, precision: 9, scale: 2 }),
      makeParam('minSqFt', 'int', { ordinal: 8, precision: 10 }),
      makeParam('maxSqFt', 'int', { ordinal: 9, precision: 10 }),
    ],
  },

  // MOCK ONLY — replace with real sys.parameters output once SQL Server is available.
  'dbo.getloveableapiagentroster': {
    schema: 'dbo',
    name: 'GetLoveableAPIAgentRoster',
    qualifiedName: 'dbo.GetLoveableAPIAgentRoster',
    normalizedName: 'dbo.getloveableapiagentroster',
    parameters: [
      makeParam('agent_id', 'int', { ordinal: 1, precision: 10 }),
      makeParam('office_code', 'varchar', { ordinal: 2, maxLength: 20 }),
      makeParam('include_inactive', 'bit', { ordinal: 3 }),
      makeParam('search_name', 'nvarchar', { ordinal: 4, maxLength: 200 }),
    ],
  },
};

function getMockProcedureMetadata(procedureName) {
  const key = normalizeProcedureName(procedureName);
  const metadata = MOCK_PROCEDURES[key];

  if (!metadata) {
    const error = new Error(`Stored procedure not found: ${key}`);
    error.code = 'PROCEDURE_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Return a shallow copy so callers cannot mutate the catalog by accident.
  return {
    schema: metadata.schema,
    name: metadata.name,
    qualifiedName: metadata.qualifiedName,
    normalizedName: metadata.normalizedName,
    parameters: metadata.parameters.map((param) => ({ ...param })),
    mock: true,
  };
}

function buildMockExecutionResult(procedureQualifiedName, normalizedParameters) {
  return {
    success: true,
    executed: true,
    mock: true,
    procedure: procedureQualifiedName,
    validation: {
      valid: true,
      errors: [],
    },
    result: {
      recordsets: [[]],
      rowsAffected: [0],
      truncated: false,
      maxRows: env.procedureResultMaxRows,
      mock: true,
      data: [],
      message: 'Mock execution completed. No SQL Server query was executed.',
      parametersEcho: normalizedParameters || {},
    },
    errors: [],
    message: 'Mock execution completed. No SQL Server query was executed.',
  };
}

module.exports = {
  getMockProcedureMetadata,
  buildMockExecutionResult,
};
