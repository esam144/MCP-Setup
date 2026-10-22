const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

describe('genuine MCP client-server communication with mock database', () => {
  let httpServer;
  let baseUrl;
  let client;
  let createProcedureMcpServer;
  let parseToolResult;

  before(async () => {
    process.env.NODE_ENV = 'development';
    process.env.MOCK_DATABASE = 'true';
    process.env.ALLOWED_PROCEDURES =
      'dbo.GetLoveableAPIListings,dbo.GetLoveableAPIAgentRoster';
    process.env.BUSINESS_RULES_JSON = JSON.stringify({
      'dbo.GetLoveableAPIListings': {
        required: ['listing_type'],
        enums: { listing_type: ['sale', 'rental'] },
        pairs: [
          { min: 'minBed', max: 'maxBed' },
          { min: 'minSqFt', max: 'maxSqFt' },
        ],
      },
    });
    process.env.MCP_AUTH_TOKEN = '';
    delete process.env.SQL_SERVER;
    delete process.env.SQL_DATABASE;
    delete process.env.SQL_USER;
    delete process.env.SQL_PASSWORD;

    const reload = [
      '../src/config/env',
      '../src/config/businessRules',
      '../src/config/database',
      '../src/mocks/mockDatabase',
      '../src/services/procedureMetadata',
      '../src/services/parameterValidator',
      '../src/services/procedureExecutor',
      '../src/services/geminiService',
      '../src/mcp/toolResult',
      '../src/mcp/createServer',
    ];
    for (const id of reload) {
      delete require.cache[require.resolve(id)];
    }

    ({ createProcedureMcpServer } = require('../src/mcp/createServer'));
    ({ parseToolResult } = require('../src/mcp/toolResult'));
    const { clearMetadataCache } = require('../src/services/procedureMetadata');
    clearMetadataCache();

    // Real MCP Streamable HTTP server (same transport style as src/mcpServer.js).
    const app = express();
    app.use(express.json({ limit: '100kb' }));

    app.post('/mcp', async (req, res) => {
      const server = createProcedureMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      res.on('close', () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });

    await new Promise((resolve) => {
      httpServer = app.listen(0, '127.0.0.1', resolve);
    });
    const address = httpServer.address();
    baseUrl = `http://127.0.0.1:${address.port}/mcp`;

    client = new Client({ name: 'mock-integration-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(baseUrl));
    await client.connect(transport);
  });

  after(async () => {
    if (client) {
      try {
        await client.close();
      } catch {
        // ignore
      }
    }
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
    }
  });

  it('connects and discovers MCP tools', async () => {
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    assert.ok(names.includes('list_stored_procedures'));
    assert.ok(names.includes('get_procedure_parameters'));
    assert.ok(names.includes('validate_parameters'));
    assert.ok(names.includes('execute_stored_procedure'));
  });

  it('calls list_stored_procedures over MCP', async () => {
    const raw = await client.callTool({ name: 'list_stored_procedures', arguments: {} });
    const parsed = parseToolResult(raw);
    assert.equal(parsed.success, true);
    assert.ok(parsed.procedures.length >= 2);
  });

  it('calls get_procedure_parameters over MCP', async () => {
    const raw = await client.callTool({
      name: 'get_procedure_parameters',
      arguments: { procedure: 'dbo.GetLoveableAPIListings' },
    });
    const parsed = parseToolResult(raw);
    assert.equal(parsed.success, true);
    assert.equal(parsed.metadata.mock, true);
    assert.ok(parsed.metadata.parameters.some((p) => p.name.includes('minBed')));
  });

  it('calls validate_parameters and rejects invalid integers over MCP', async () => {
    const raw = await client.callTool({
      name: 'validate_parameters',
      arguments: {
        procedure: 'dbo.GetLoveableAPIListings',
        parameters: { listing_type: 'sale', minBed: 'hello', maxBed: 3 },
      },
    });
    const parsed = parseToolResult(raw);
    assert.equal(parsed.valid, false);
    assert.ok(parsed.errors.some((e) => e.code === 'INVALID_TYPE'));
  });

  it('rejects unauthorized procedures over MCP', async () => {
    const raw = await client.callTool({
      name: 'validate_parameters',
      arguments: {
        procedure: 'dbo.NotAllowed',
        parameters: {},
      },
    });
    const parsed = parseToolResult(raw);
    assert.equal(parsed.valid, false);
    assert.ok(parsed.errors.some((e) => e.code === 'PROCEDURE_NOT_ALLOWED'));
  });

  it('mock execution returns labelled fake data without real SQL', async () => {
    const { wasRealConnectAttempted } = require('../src/config/database');
    const raw = await client.callTool({
      name: 'execute_stored_procedure',
      arguments: {
        procedure: 'dbo.GetLoveableAPIListings',
        parameters: { listing_type: 'sale', minBed: 1, maxBed: 2 },
      },
    });
    const parsed = parseToolResult(raw);
    assert.equal(parsed.success, true);
    assert.equal(parsed.mock, true);
    assert.match(parsed.message, /No SQL Server query was executed/);
    assert.equal(wasRealConnectAttempted(), false);
  });
});
