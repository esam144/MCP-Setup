// Standalone MCP server process (Streamable HTTP on /mcp).
// Start with: npm run mcp

require('./config/env');
const express = require('express');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { createProcedureMcpServer } = require('./mcp/createServer');
const { env, getStartupWarnings, assertMockModeSafe, getDatabaseModeLabel } = require('./config/env');
const { closePool } = require('./config/database');

function authMiddleware(req, res, next) {
  // If no token is configured, allow local development without auth.
  if (!env.mcpAuthToken) {
    return next();
  }

  const header = req.headers.authorization || '';
  let token = '';
  if (header.startsWith('Bearer ')) {
    token = header.slice(7);
  }

  if (token !== env.mcpAuthToken) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized' },
      id: null,
    });
    return;
  }

  next();
}

// Stateless mode: create a fresh MCP server + transport for each POST.
async function handleMcpPost(req, res) {
  const server = createProcedureMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP request failed:', error.message);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
}

async function main() {
  assertMockModeSafe();
  console.log(`[mcp] Database mode: ${getDatabaseModeLabel()}`);

  for (const warning of getStartupWarnings()) {
    console.warn(`[mcp] ${warning}`);
  }

  const app = express();
  app.use(express.json({ limit: env.requestBodyLimit }));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'mcp-server' });
  });

  app.post('/mcp', authMiddleware, handleMcpPost);

  app.get('/mcp', authMiddleware, (req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed. Use POST for stateless Streamable HTTP.',
      },
      id: null,
    });
  });

  app.delete('/mcp', authMiddleware, (req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed in stateless mode.' },
      id: null,
    });
  });

  const httpServer = app.listen(env.mcpServerPort, env.mcpBindHost, () => {
    console.log(
      `MCP server listening on http://${env.mcpBindHost}:${env.mcpServerPort}/mcp`
    );
  });

  async function shutdown(signal) {
    console.log(`Shutting down MCP server (${signal})...`);
    httpServer.close();
    await closePool();
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('Failed to start MCP server:', error.message);
  process.exit(1);
});
