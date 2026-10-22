// Thin HTTP response mappers for the frontend.
// Internal services and MCP tools keep full metadata for validation/execution.

function simplifyProceduresList(result) {
  if (!result || result.success === false) {
    return {
      success: false,
      error: result && result.error ? result.error : { code: 'LIST_FAILED', message: 'Failed to list procedures' },
    };
  }

  const procedures = [];
  const list = Array.isArray(result.procedures) ? result.procedures : [];
  for (const item of list) {
    if (typeof item === 'string') {
      procedures.push(item);
    } else if (item && item.qualifiedName) {
      procedures.push(item.qualifiedName);
    }
  }

  return {
    success: true,
    procedures,
  };
}

function simplifyProcedureParameters(result) {
  if (!result || result.success === false) {
    return {
      success: false,
      error: result && result.error ? result.error : { code: 'METADATA_FAILED', message: 'Failed to load parameters' },
    };
  }

  const metadata = result.metadata || {};
  const parameters = [];
  const rawParams = Array.isArray(metadata.parameters) ? metadata.parameters : [];

  for (const param of rawParams) {
    const name = String(param.name || '').replace(/^@/, '');
    if (!name || name.toLowerCase() === 'return_value') {
      continue;
    }
    parameters.push({
      name,
      type: param.sqlType || param.type || 'unknown',
    });
  }

  return {
    success: true,
    procedure: metadata.qualifiedName || metadata.name || null,
    parameters,
  };
}

function simplifyValidate(result) {
  if (!result) {
    return {
      success: false,
      valid: false,
      procedure: null,
      errors: [{ parameter: null, code: 'VALIDATE_FAILED', message: 'Empty validation result' }],
    };
  }

  const response = {
    success: Boolean(result.valid),
    valid: Boolean(result.valid),
    procedure: result.procedure || null,
    errors: Array.isArray(result.errors) ? result.errors : [],
  };

  if (result.valid && result.normalizedParameters) {
    response.parameters = result.normalizedParameters;
  }

  // Optional semantic review only when the client asked for it and data exists.
  if (result.semantic && result.semantic.available) {
    response.semantic = {
      available: true,
      issues: Array.isArray(result.semantic.issues) ? result.semantic.issues : [],
    };
  }

  return response;
}

function simplifyInterpret(result) {
  if (!result) {
    return {
      success: false,
      procedure: null,
      parameters: {},
      errors: [{ parameter: 'gemini', code: 'INTERPRET_FAILED', message: 'Empty interpret result' }],
    };
  }

  const response = {
    success: Boolean(result.success),
    procedure: result.procedure || null,
    parameters: result.parameters || {},
    errors: Array.isArray(result.errors) ? result.errors : [],
  };

  if (result.ambiguous) {
    response.ambiguous = true;
  }
  if (result.clarification) {
    response.clarification = result.clarification;
  }
  if (result.rationale) {
    response.rationale = result.rationale;
  }
  // Keep status hint for the route layer; strip before sending if desired.
  if (result.httpStatusHint) {
    response.httpStatusHint = result.httpStatusHint;
  }

  // Do not include validation.metadata or nested full validation objects.
  return response;
}

function simplifyExecute(result) {
  if (!result) {
    return {
      success: false,
      procedure: null,
      errors: [{ parameter: null, code: 'EXECUTE_FAILED', message: 'Empty execute result' }],
    };
  }

  if (!result.success) {
    return {
      success: false,
      procedure: result.procedure || null,
      errors: Array.isArray(result.errors) ? result.errors : [],
    };
  }

  // Mock execution — clearly labelled, no nested recordsets noise.
  if (result.mock) {
    const mockData =
      (result.result && Array.isArray(result.result.data) && result.result.data) ||
      (result.result && Array.isArray(result.result.recordsets) && result.result.recordsets[0]) ||
      [];

    return {
      success: true,
      mock: true,
      procedure: result.procedure || null,
      data: mockData,
      message:
        result.message ||
        (result.result && result.result.message) ||
        'Mock execution completed. No SQL Server query was executed.',
    };
  }

  // Real SQL execution — return first recordset as data when present.
  const recordsets = (result.result && result.result.recordsets) || [];
  const data = Array.isArray(recordsets[0]) ? recordsets[0] : [];

  return {
    success: true,
    mock: false,
    procedure: result.procedure || null,
    data,
    message: 'Stored procedure executed successfully.',
  };
}

module.exports = {
  simplifyProceduresList,
  simplifyProcedureParameters,
  simplifyValidate,
  simplifyInterpret,
  simplifyExecute,
};
