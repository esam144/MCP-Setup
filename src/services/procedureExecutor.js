// Runs an allowlisted stored procedure after re-validating parameters.
// Values are bound with mssql request.input() — never string-concatenated into SQL.

const { getPool, sql, isMockDatabase } = require('../config/database');
const { env } = require('../config/env');
const { getProcedureMetadata, assertAllowedProcedure, splitQualifiedName } = require('./procedureMetadata');
const { validateParameters, stripAt } = require('./parameterValidator');
const { buildMockExecutionResult } = require('../mocks/mockDatabase');

// Map SQL Server type names to mssql binder types.
const TYPE_MAP = {
  int: () => sql.Int,
  bigint: () => sql.BigInt,
  smallint: () => sql.SmallInt,
  tinyint: () => sql.TinyInt,
  bit: () => sql.Bit,
  float: () => sql.Float,
  real: () => sql.Real,
  decimal: (param) => sql.Decimal(param.precision || 18, param.scale || 0),
  numeric: (param) => sql.Numeric(param.precision || 18, param.scale || 0),
  money: () => sql.Money,
  smallmoney: () => sql.SmallMoney,
  varchar: (param) => {
    if (param.maxLength && param.maxLength > 0) {
      return sql.VarChar(param.maxLength);
    }
    return sql.VarChar(sql.MAX);
  },
  nvarchar: (param) => {
    if (param.maxLength && param.maxLength > 0) {
      const charLength = Math.floor(param.maxLength / 2) || sql.MAX;
      return sql.NVarChar(charLength);
    }
    return sql.NVarChar(sql.MAX);
  },
  char: (param) => sql.Char(param.maxLength && param.maxLength > 0 ? param.maxLength : 1),
  nchar: (param) => {
    if (param.maxLength && param.maxLength > 0) {
      return sql.NChar(Math.floor(param.maxLength / 2) || 1);
    }
    return sql.NChar(1);
  },
  text: () => sql.Text,
  ntext: () => sql.NText,
  date: () => sql.Date,
  datetime: () => sql.DateTime,
  datetime2: () => sql.DateTime2(7),
  smalldatetime: () => sql.SmallDateTime,
  datetimeoffset: () => sql.DateTimeOffset(7),
  uniqueidentifier: () => sql.UniqueIdentifier,
};

function resolveSqlType(param) {
  const typeName = String(param.sqlType || '').toLowerCase();
  const factory = TYPE_MAP[typeName];

  if (!factory) {
    const error = new Error(`Unsupported SQL type for binding: ${param.sqlType}`);
    error.code = 'UNSUPPORTED_TYPE';
    error.status = 400;
    throw error;
  }

  return factory(param);
}

// Quote a SQL identifier safely: name -> [name], na]me -> [na]]me]
function quoteIdent(ident) {
  const escaped = String(ident).replace(/]/g, ']]');
  return `[${escaped}]`;
}

// Cap how many rows we return to the API client.
function boundRows(recordsets) {
  const maxRows = env.procedureResultMaxRows;
  if (!Array.isArray(recordsets)) {
    return [];
  }

  const limited = [];
  for (const set of recordsets) {
    if (!Array.isArray(set)) {
      limited.push(set);
    } else {
      limited.push(set.slice(0, maxRows));
    }
  }
  return limited;
}

function wasTruncated(recordsets) {
  if (!Array.isArray(recordsets)) {
    return false;
  }

  for (const set of recordsets) {
    if (Array.isArray(set) && set.length > env.procedureResultMaxRows) {
      return true;
    }
  }
  return false;
}

async function executeStoredProcedure(procedureName, parameters = {}) {
  // Security: always re-validate right before execution.
  const validation = await validateParameters(procedureName, parameters);
  if (!validation.valid) {
    return {
      success: false,
      executed: false,
      procedure: validation.procedure,
      validation,
      errors: validation.errors,
      result: null,
    };
  }

  const normalized = assertAllowedProcedure(procedureName);
  const metadata = validation.metadata || (await getProcedureMetadata(normalized));

  // Development mock path — never touches SQL Server.
  if (isMockDatabase()) {
    return buildMockExecutionResult(
      metadata.qualifiedName,
      validation.normalizedParameters || {}
    );
  }

  const parts = splitQualifiedName(metadata.normalizedName || normalized);

  // Only run schema.procedure from the allowlist — never arbitrary SQL text.
  const procedureSql = `${quoteIdent(parts.schema)}.${quoteIdent(parts.name)}`;

  const pool = await getPool();
  const request = pool.request();
  request.timeout = env.sql.requestTimeoutMs;

  // Index metadata by parameter name for type binding.
  const paramIndex = new Map();
  for (const param of metadata.parameters) {
    paramIndex.set(stripAt(param.name).toLowerCase(), param);
  }

  // Bind each validated value as a typed parameter.
  const normalizedParameters = validation.normalizedParameters || {};
  for (const key of Object.keys(normalizedParameters)) {
    const value = normalizedParameters[key];
    const meta = paramIndex.get(stripAt(key).toLowerCase());
    if (!meta) {
      continue;
    }
    const sqlType = resolveSqlType(meta);
    request.input(stripAt(meta.name), sqlType, value);
  }

  try {
    const sqlResult = await request.execute(procedureSql);
    const recordsets = boundRows(sqlResult.recordsets || []);
    const rowsAffected = Array.isArray(sqlResult.rowsAffected) ? sqlResult.rowsAffected : [];

    return {
      success: true,
      executed: true,
      procedure: metadata.qualifiedName,
      validation: {
        valid: true,
        errors: [],
      },
      result: {
        recordsets,
        rowsAffected,
        truncated: wasTruncated(sqlResult.recordsets || []),
        maxRows: env.procedureResultMaxRows,
      },
      errors: [],
    };
  } catch (cause) {
    // Do not leak raw SQL Server details to the client.
    // A real SQL failure never flips the app into mock mode.
    if (env.nodeEnv === 'development') {
      console.error('[execute]', cause.message);
    }

    return {
      success: false,
      executed: false,
      procedure: metadata.qualifiedName,
      validation: { valid: true, errors: [] },
      result: null,
      errors: [
        {
          parameter: null,
          code: 'PROCEDURE_EXECUTION_FAILED',
          message: 'The stored procedure could not be executed. Check server logs for details.',
        },
      ],
      _internalMessage: env.nodeEnv === 'development' ? cause.message : undefined,
    };
  }
}

module.exports = {
  executeStoredProcedure,
  quoteIdent,
};
