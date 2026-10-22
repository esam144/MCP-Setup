const express = require('express');
const { callMcpTool } = require('../mcp/client');
const { simplifyValidate, simplifyInterpret } = require('../utils/responseSimplifiers');

const router = express.Router();

// POST /api/validate — deterministic validation (optional Gemini semantic review).
router.post('/validate', async (req, res, next) => {
  try {
    const body = req.body || {};
    const procedure = body.procedure;
    const parameters = body.parameters;
    const includeSemantic = body.includeSemantic;

    if (!procedure || typeof procedure !== 'string') {
      return res.status(400).json({
        success: false,
        valid: false,
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
          valid: false,
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

    const result = await callMcpTool('validate_parameters', {
      procedure,
      parameters: parameters || {},
      includeSemantic: Boolean(includeSemantic),
    });

    const simplified = simplifyValidate(result);
    const status = simplified.valid ? 200 : 400;
    return res.status(status).json(simplified);
  } catch (error) {
    if (error.payload) {
      return res.status(error.status || 400).json(simplifyValidate(error.payload));
    }
    return next(error);
  }
});

// POST /api/interpret — Gemini NL proposal (never executes SQL).
router.post('/interpret', async (req, res, next) => {
  try {
    const body = req.body || {};
    const request = body.request;

    if (!request || typeof request !== 'string') {
      return res.status(400).json({
        success: false,
        errors: [
          {
            parameter: 'request',
            code: 'INVALID_REQUEST',
            message: 'request is required.',
          },
        ],
      });
    }

    const result = await callMcpTool('interpret_request', { request });
    const simplified = simplifyInterpret(result);

    let status = 400;
    if (simplified.success || (simplified.ambiguous && (!simplified.errors || simplified.errors.length === 0))) {
      status = 200;
    }

    if (simplified.httpStatusHint && Number.isFinite(simplified.httpStatusHint)) {
      status = simplified.httpStatusHint;
    } else if (simplified.errors && simplified.errors[0]) {
      const code = simplified.errors[0].code;
      if (
        code === 'GEMINI_TIMEOUT' ||
        code === 'GEMINI_UNAVAILABLE' ||
        code === 'GEMINI_CONFIG_MISSING'
      ) {
        status = 503;
      } else if (code === 'GEMINI_RATE_LIMITED') {
        status = 429;
      } else if (code === 'GEMINI_AUTH_FAILED') {
        status = 401;
      } else if (code === 'GEMINI_MODEL_UNAVAILABLE') {
        status = 404;
      }
    }

    // Do not expose the internal status hint to the frontend.
    const { httpStatusHint, ...bodyOut } = simplified;
    return res.status(status).json(bodyOut);
  } catch (error) {
    if (error.payload) {
      const simplified = simplifyInterpret(error.payload);
      const { httpStatusHint, ...bodyOut } = simplified;
      return res.status(error.status || 400).json(bodyOut);
    }
    return next(error);
  }
});

module.exports = router;
