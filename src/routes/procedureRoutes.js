const express = require('express');
const { callMcpTool } = require('../mcp/client');
const {
  simplifyProceduresList,
  simplifyProcedureParameters,
} = require('../utils/responseSimplifiers');

const router = express.Router();

// GET /api/procedures — list allowlisted stored procedures via MCP.
router.get('/procedures', async (req, res, next) => {
  try {
    const result = await callMcpTool('list_stored_procedures', {});
    res.status(200).json(simplifyProceduresList(result));
  } catch (error) {
    next(error);
  }
});

// GET /api/procedures/:procedure/parameters — metadata for one approved procedure.
router.get('/procedures/:procedure/parameters', async (req, res, next) => {
  try {
    const refresh = String(req.query.refresh || '').toLowerCase() === 'true';
    const procedure = decodeURIComponent(req.params.procedure);
    const result = await callMcpTool('get_procedure_parameters', {
      procedure,
      refresh,
    });

    const simplified = simplifyProcedureParameters(result);

    if (result.success === false) {
      let status = 400;
      if (result.error && result.error.code === 'PROCEDURE_NOT_FOUND') {
        status = 404;
      } else if (result.error && result.error.code === 'PROCEDURE_NOT_ALLOWED') {
        status = 403;
      }
      return res.status(status).json(simplified);
    }

    return res.status(200).json(simplified);
  } catch (error) {
    next(error);
  }
});

// POST /api/procedures/refresh-cache — clear MCP/SQL metadata cache.
router.post('/procedures/refresh-cache', async (req, res, next) => {
  try {
    const result = await callMcpTool('refresh_metadata_cache', {});
    res.status(200).json({
      success: Boolean(result && result.success),
      cleared: Boolean(result && result.cleared),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
