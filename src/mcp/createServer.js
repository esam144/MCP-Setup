// Builds the MCP server and registers tools that Express will call via the MCP client.
// Each tool wraps an existing service (metadata, validation, Gemini, execution).

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const { toolSuccess, toolFailure } = require('./toolResult');
const {
  listAllowedProcedures,
  getProcedureMetadata,
  clearMetadataCache,
} = require('../services/procedureMetadata');
const { validateParameters } = require('../services/parameterValidator');
const { interpretRequest, semanticValidate } = require('../services/geminiService');
const { executeStoredProcedure } = require('../services/procedureExecutor');

function createProcedureMcpServer() {
  const server = new McpServer({
    name: 'sql-procedure-validator',
    version: '1.0.0',
  });

  server.registerTool(
    'list_stored_procedures',
    {
      description: 'List schema-qualified stored procedures approved for this application.',
      inputSchema: {},
    },
    async () => {
      try {
        const procedures = listAllowedProcedures();
        return toolSuccess({ success: true, procedures });
      } catch (error) {
        return toolFailure({
          success: false,
          error: { code: error.code || 'LIST_FAILED', message: error.message },
        });
      }
    }
  );

  server.registerTool(
    'get_procedure_parameters',
    {
      description: 'Retrieve parameter metadata for an approved stored procedure from SQL Server.',
      inputSchema: {
        procedure: z.string().describe('Schema-qualified or unqualified procedure name'),
        refresh: z.boolean().optional().describe('Bypass metadata cache when true'),
      },
    },
    async ({ procedure, refresh }) => {
      try {
        const metadata = await getProcedureMetadata(procedure, {
          refresh: Boolean(refresh),
        });
        return toolSuccess({ success: true, metadata });
      } catch (error) {
        return toolFailure({
          success: false,
          error: { code: error.code || 'METADATA_FAILED', message: error.message },
        });
      }
    }
  );

  server.registerTool(
    'validate_parameters',
    {
      description:
        'Deterministically validate parameter key-value pairs against SQL Server metadata and business rules. Does not execute the procedure.',
      inputSchema: {
        procedure: z.string(),
        parameters: z.record(z.string(), z.any()).optional(),
        includeSemantic: z.boolean().optional(),
      },
    },
    async ({ procedure, parameters = {}, includeSemantic = false }) => {
      try {
        const deterministic = await validateParameters(procedure, parameters);

        let semantic = null;
        if (includeSemantic) {
          semantic = await semanticValidate(procedure, parameters, deterministic);
        }

        return toolSuccess({
          success: deterministic.valid,
          valid: deterministic.valid,
          procedure: deterministic.procedure,
          errors: deterministic.errors,
          normalizedParameters: deterministic.normalizedParameters,
          semantic,
        });
      } catch (error) {
        return toolFailure({
          success: false,
          valid: false,
          procedure,
          errors: [
            {
              parameter: null,
              code: error.code || 'VALIDATE_FAILED',
              message: error.message,
            },
          ],
        });
      }
    }
  );

  server.registerTool(
    'interpret_request',
    {
      description:
        'Use Gemini to interpret a natural-language request into an approved procedure and parameters. Never executes SQL.',
      inputSchema: {
        request: z.string().min(1),
      },
    },
    async ({ request }) => {
      try {
        const result = await interpretRequest(request);
        return toolSuccess(result);
      } catch (error) {
        return toolFailure({
          success: false,
          ambiguous: true,
          clarification: 'Interpretation failed.',
          procedure: null,
          parameters: {},
          errors: [
            {
              parameter: 'gemini',
              code: error.code || 'INTERPRET_FAILED',
              message: error.message,
            },
          ],
        });
      }
    }
  );

  server.registerTool(
    'execute_stored_procedure',
    {
      description:
        'Execute an approved stored procedure with validated parameters. Re-runs deterministic validation before execution.',
      inputSchema: {
        procedure: z.string(),
        parameters: z.record(z.string(), z.any()).optional(),
      },
    },
    async ({ procedure, parameters = {} }) => {
      try {
        const result = await executeStoredProcedure(procedure, parameters);
        if (!result.success) {
          return toolFailure(result);
        }
        return toolSuccess(result);
      } catch (error) {
        return toolFailure({
          success: false,
          executed: false,
          procedure,
          errors: [
            {
              parameter: null,
              code: error.code || 'EXECUTE_FAILED',
              message: error.message,
            },
          ],
          result: null,
        });
      }
    }
  );

  server.registerTool(
    'refresh_metadata_cache',
    {
      description: 'Clear the in-memory stored procedure metadata cache.',
      inputSchema: {},
    },
    async () => {
      clearMetadataCache();
      return toolSuccess({ success: true, cleared: true });
    }
  );

  return server;
}

module.exports = {
  createProcedureMcpServer,
};
