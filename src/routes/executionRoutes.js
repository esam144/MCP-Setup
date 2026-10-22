const express = require('express');
const { callMcpTool } = require('../mcp/client');
const { requireApiAuth } = require('../middleware/errorHandler');
const { simplifyExecute } = require('../utils/responseSimplifiers');

const router = express.Router();

// Only allow simple schema.procedure names (blocks arbitrary SQL strings).
function isSafeProcedureName(procedureName) {
  const cleaned = String(procedureName).replace(/[\[\]]/g, '');
  return /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(cleaned);
}

// POST /api/execute — validate then run an allowlisted procedure through MCP.
router.post('/execute', requireApiAuth, async (req, res, next) => {
  try {
    const body = req.body || {};
    const procedure = body.procedure;
    const parameters = body.parameters;

    if (!procedure || typeof procedure !== 'string') {
      return res.status(400).json({
        success: false,
        procedure: null,
        errors: [
          {
            parameter: 'procedure',
            code: 'INVALID_REQUEST',
            message: 'procedure is required.',
          },
        ],
      });
    }

    if (parameters !== undefined) {
      const isObject = typeof parameters === 'object' && parameters !== null && !Array.isArray(parameters);
      if (!isObject) {
        return res.status(400).json({
          success: false,
          procedure: null,
          errors: [
            {
              parameter: 'parameters',
              code: 'INVALID_REQUEST',
              message: 'parameters must be an object.',
            },
          ],
        });
      }
    }

    if (!isSafeProcedureName(procedure)) {
      return res.status(400).json({
        success: false,
        procedure: null,
        errors: [
          {
            parameter: 'procedure',
            code: 'ARBITRARY_SQL_REJECTED',
            message:
              'Arbitrary SQL is not allowed. Provide an allowlisted stored procedure name only.',
          },
        ],
      });
    }

    let result;
    try {
      result = await callMcpTool('execute_stored_procedure', {
        procedure,
        parameters: parameters || {},
      });
    } catch (error) {
      if (error.payload) {
        let status = error.status || 400;
        if (error.payload.executed === false && error.payload.errors && error.payload.errors.length) {
          status = 400;
        }
        return res.status(status).json(simplifyExecute(error.payload));
      }
      throw error;
    }

    const simplified = simplifyExecute(result);

    if (!simplified.success) {
      let status = 400;
      if (simplified.errors) {
        for (const item of simplified.errors) {
          if (item.code === 'PROCEDURE_EXECUTION_FAILED') {
            status = 500;
            break;
          }
        }
      }
      return res.status(status).json(simplified);
    }

    return res.status(200).json(simplified);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
