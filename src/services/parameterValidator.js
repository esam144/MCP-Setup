// Deterministic parameter validation against SQL metadata + optional business rules.
// This never executes a stored procedure.

const { getProcedureMetadata, assertAllowedProcedure, normalizeProcedureName } = require('./procedureMetadata');
const { getBusinessRules } = require('../config/businessRules');

const INTEGER_TYPES = new Set(['int', 'bigint', 'smallint', 'tinyint']);
const DECIMAL_TYPES = new Set(['decimal', 'numeric', 'money', 'smallmoney']);
const FLOAT_TYPES = new Set(['float', 'real']);
const STRING_TYPES = new Set(['varchar', 'nvarchar', 'char', 'nchar', 'text', 'ntext']);
const DATE_TYPES = new Set(['date', 'datetime', 'datetime2', 'smalldatetime', 'datetimeoffset']);
const BOOL_TYPES = new Set(['bit']);
const GUID_TYPES = new Set(['uniqueidentifier']);

function makeError(parameter, code, message) {
  return { parameter, code, message };
}

// SQL parameters often look like @minBed — strip the leading @ for comparisons.
function stripAt(name) {
  return String(name || '').replace(/^@/, '');
}

function buildParamIndex(metadata) {
  const byName = new Map();
  for (const param of metadata.parameters) {
    byName.set(stripAt(param.name).toLowerCase(), param);
  }
  return byName;
}

function isMissing(value) {
  return value === undefined;
}

function isNullLike(value) {
  return value === null || value === 'NULL' || value === 'null';
}

function parseInteger(value) {
  if (typeof value === 'boolean') {
    return null;
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return null;
}

function parseDecimal(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

function parseBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 0 || value === '0' || value === 'false' || value === 'FALSE') {
    return false;
  }
  if (value === 1 || value === '1' || value === 'true' || value === 'TRUE') {
    return true;
  }
  return null;
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
}

function parseGuid(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const pattern =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (pattern.test(value.trim())) {
    return value.trim();
  }
  return null;
}

function validateStringLength(param, value) {
  const name = stripAt(param.name);

  if (typeof value !== 'string') {
    return makeError(name, 'INVALID_TYPE', `Expected a string for ${param.sqlType}.`);
  }

  // SQL Server stores nvarchar/nchar max_length in bytes (2 bytes per character).
  if (param.maxLength != null && param.maxLength > 0 && param.maxLength !== -1) {
    const isUnicode = param.sqlType.startsWith('n');
    let maxChars = param.maxLength;
    if (isUnicode) {
      maxChars = Math.floor(param.maxLength / 2);
    }

    if (maxChars > 0 && value.length > maxChars) {
      return makeError(
        name,
        'STRING_TOO_LONG',
        `Value exceeds maximum length of ${maxChars} characters.`
      );
    }
  }

  return null;
}

function validateDecimalPrecision(param, value) {
  if (param.precision == null || param.precision <= 0) {
    return null;
  }

  const name = stripAt(param.name);
  const parts = String(Math.abs(value)).split('.');
  const intPart = parts[0];
  const fracPart = parts[1] || '';
  const digitCount = intPart.replace(/^0+(?=\d)/, '').length + fracPart.length;

  if (digitCount > param.precision) {
    return makeError(name, 'PRECISION_EXCEEDED', `Value exceeds precision ${param.precision}.`);
  }

  if (param.scale != null && fracPart.length > param.scale) {
    return makeError(name, 'SCALE_EXCEEDED', `Value exceeds scale ${param.scale}.`);
  }

  return null;
}

function validateSingleValue(param, value) {
  const name = stripAt(param.name);
  const type = String(param.sqlType || '').toLowerCase();

  // Reject SQL return-value output parameters as normal inputs.
  if (param.isOutput && !param.hasDefaultValue) {
    if (name.toLowerCase() === 'return_value' || param.name === '@RETURN_VALUE') {
      return makeError(name, 'OUTPUT_ONLY', 'Output-only parameters cannot be supplied as input.');
    }
  }

  if (isNullLike(value)) {
    return { ok: true, value: null };
  }

  if (INTEGER_TYPES.has(type)) {
    const parsed = parseInteger(value);
    if (parsed === null) {
      return makeError(name, 'INVALID_TYPE', 'Expected an integer.');
    }
    if (type === 'tinyint' && (parsed < 0 || parsed > 255)) {
      return makeError(name, 'OUT_OF_RANGE', 'tinyint must be between 0 and 255.');
    }
    if (type === 'smallint' && (parsed < -32768 || parsed > 32767)) {
      return makeError(name, 'OUT_OF_RANGE', 'smallint out of range.');
    }
    if (type === 'int' && (parsed < -2147483648 || parsed > 2147483647)) {
      return makeError(name, 'OUT_OF_RANGE', 'int out of range.');
    }
    return { ok: true, value: parsed };
  }

  if (DECIMAL_TYPES.has(type)) {
    const parsed = parseDecimal(value);
    if (parsed === null) {
      return makeError(name, 'INVALID_TYPE', 'Expected a decimal number.');
    }
    const precisionError = validateDecimalPrecision(param, parsed);
    if (precisionError) {
      return precisionError;
    }
    return { ok: true, value: parsed };
  }

  if (FLOAT_TYPES.has(type)) {
    const parsed = parseDecimal(value);
    if (parsed === null) {
      return makeError(name, 'INVALID_TYPE', 'Expected a floating-point number.');
    }
    return { ok: true, value: parsed };
  }

  if (STRING_TYPES.has(type)) {
    const lengthError = validateStringLength(param, value);
    if (lengthError) {
      return lengthError;
    }
    return { ok: true, value: String(value) };
  }

  if (BOOL_TYPES.has(type)) {
    const parsed = parseBoolean(value);
    if (parsed === null) {
      return makeError(name, 'INVALID_TYPE', 'Expected a boolean (bit) value.');
    }
    return { ok: true, value: parsed };
  }

  if (DATE_TYPES.has(type)) {
    const parsed = parseDate(value);
    if (!parsed) {
      return makeError(name, 'INVALID_TYPE', 'Expected a valid date/datetime value.');
    }
    return { ok: true, value: parsed };
  }

  if (GUID_TYPES.has(type)) {
    const parsed = parseGuid(value);
    if (!parsed) {
      return makeError(name, 'INVALID_TYPE', 'Expected a uniqueidentifier (UUID).');
    }
    return { ok: true, value: parsed };
  }

  return makeError(name, 'UNSUPPORTED_TYPE', `Unsupported SQL type: ${param.sqlType}`);
}

// Apply optional BUSINESS_RULES_JSON checks (required fields, enums, ranges, min/max pairs).
function validateAgainstRules(procedureName, parameters, errors) {
  const rules = getBusinessRules(procedureName);

  // Normalize keys to lowercase without @ for easier lookup.
  const supplied = {};
  for (const key of Object.keys(parameters || {})) {
    supplied[stripAt(key).toLowerCase()] = parameters[key];
  }

  const requiredList = rules.required || [];
  for (const requiredName of requiredList) {
    const key = stripAt(requiredName).toLowerCase();
    if (isMissing(supplied[key]) || isNullLike(supplied[key])) {
      errors.push(
        makeError(
          stripAt(requiredName),
          'REQUIRED',
          `Parameter "${stripAt(requiredName)}" is required.`
        )
      );
    }
  }

  // Exact allowed values only — never silently rewrite (e.g. sales -> sale).
  // multiValueParams (e.g. propTypes) may be a comma-separated list of exact enum tokens.
  const enums = rules.enums || {};
  const multiValueParams = new Set(
    (rules.multiValueParams || []).map((name) => stripAt(name).toLowerCase())
  );

  for (const paramName of Object.keys(enums)) {
    const allowedValues = enums[paramName];
    if (!Array.isArray(allowedValues) || allowedValues.length === 0) {
      continue;
    }

    const key = stripAt(paramName).toLowerCase();
    const value = supplied[key];

    // Missing/null are handled by required rules when configured.
    if (isMissing(value) || isNullLike(value)) {
      continue;
    }

    const displayName = stripAt(paramName);
    const allowedLabel = allowedValues.join(', ');

    if (multiValueParams.has(key)) {
      if (typeof value !== 'string') {
        errors.push(
          makeError(displayName, 'INVALID_TYPE', `Parameter "${displayName}" must be a string.`)
        );
        continue;
      }

      const tokens = value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);

      if (tokens.length === 0) {
        errors.push(
          makeError(
            displayName,
            'INVALID_VALUE',
            `Parameter "${displayName}" must be one of: ${allowedLabel}.`
          )
        );
        continue;
      }

      const invalidTokens = [];
      for (const token of tokens) {
        if (!allowedValues.includes(token)) {
          invalidTokens.push(token);
        }
      }

      if (invalidTokens.length > 0) {
        errors.push(
          makeError(
            displayName,
            'INVALID_VALUE',
            `Parameter "${displayName}" has invalid value(s): ${invalidTokens.join(', ')}. Allowed: ${allowedLabel}. Use exact names; for multiple types join with commas (e.g. "Condo, Single Family").`
          )
        );
      }
      continue;
    }

    if (!allowedValues.includes(value)) {
      errors.push(
        makeError(
          displayName,
          'INVALID_VALUE',
          `Parameter "${displayName}" must be one of: ${allowedLabel}.`
        )
      );
    }
  }

  const ranges = rules.ranges || {};
  for (const paramName of Object.keys(ranges)) {
    const range = ranges[paramName];
    const key = stripAt(paramName).toLowerCase();
    const value = supplied[key];

    if (isMissing(value) || isNullLike(value)) {
      continue;
    }

    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) {
      continue;
    }

    if (range.min != null && num < range.min) {
      errors.push(makeError(stripAt(paramName), 'MIN_VIOLATION', `Value must be >= ${range.min}.`));
    }
    if (range.max != null && num > range.max) {
      errors.push(makeError(stripAt(paramName), 'MAX_VIOLATION', `Value must be <= ${range.max}.`));
    }
  }

  const pairs = rules.pairs || [];
  for (const pair of pairs) {
    const minKey = stripAt(pair.min).toLowerCase();
    const maxKey = stripAt(pair.max).toLowerCase();
    const minVal = supplied[minKey];
    const maxVal = supplied[maxKey];

    if (isMissing(minVal) || isMissing(maxVal) || isNullLike(minVal) || isNullLike(maxVal)) {
      continue;
    }

    const minNum = typeof minVal === 'number' ? minVal : Number(minVal);
    const maxNum = typeof maxVal === 'number' ? maxVal : Number(maxVal);

    if (Number.isFinite(minNum) && Number.isFinite(maxNum) && minNum > maxNum) {
      errors.push(
        makeError(
          `${stripAt(pair.min)}/${stripAt(pair.max)}`,
          'MIN_GREATER_THAN_MAX',
          `Minimum (${stripAt(pair.min)}) cannot be greater than maximum (${stripAt(pair.max)}).`
        )
      );
    }
  }
}

async function validateParameters(procedureName, parameters = {}, options = {}) {
  let normalizedName;
  try {
    normalizedName = assertAllowedProcedure(procedureName);
  } catch (err) {
    if (err.code === 'ALLOWLIST_NOT_CONFIGURED') {
      throw err;
    }
    return {
      success: false,
      valid: false,
      procedure: normalizeProcedureName(procedureName),
      errors: [makeError('procedure', err.code || 'PROCEDURE_NOT_ALLOWED', err.message)],
      normalizedParameters: null,
    };
  }

  let metadata;
  try {
    metadata = await getProcedureMetadata(normalizedName, { refresh: options.refresh });
  } catch (err) {
    return {
      success: false,
      valid: false,
      procedure: normalizedName,
      errors: [makeError('procedure', err.code || 'PROCEDURE_LOOKUP_FAILED', err.message)],
      normalizedParameters: null,
    };
  }

  const paramIndex = buildParamIndex(metadata);
  const errors = [];
  const normalizedParameters = {};
  const inputEntries = Object.entries(parameters || {});

  for (const [rawName, rawValue] of inputEntries) {
    const key = stripAt(rawName).toLowerCase();
    const param = paramIndex.get(key);

    if (!param) {
      errors.push(
        makeError(stripAt(rawName), 'UNKNOWN_PARAMETER', `Unknown parameter "${stripAt(rawName)}".`)
      );
      continue;
    }

    if (param.isOutput && (key === 'return_value' || param.name === '@RETURN_VALUE')) {
      errors.push(
        makeError(stripAt(rawName), 'OUTPUT_ONLY', 'Output-only parameters cannot be supplied as input.')
      );
      continue;
    }

    const result = validateSingleValue(param, rawValue);
    if (result && result.ok) {
      normalizedParameters[stripAt(param.name)] = result.value;
    } else if (result) {
      errors.push(result);
    }
  }

  validateAgainstRules(normalizedName, { ...parameters, ...normalizedParameters }, errors);

  const valid = errors.length === 0;
  return {
    success: valid,
    valid,
    procedure: metadata.qualifiedName,
    errors,
    normalizedParameters: valid ? normalizedParameters : null,
    metadata,
  };
}

module.exports = {
  validateParameters,
  stripAt,
};
