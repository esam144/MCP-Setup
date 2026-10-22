// Express API entry point. Start with: npm start  or  npm run dev

const app = require('./app');
const {
  env,
  getStartupWarnings,
  assertAllowlistConfigured,
  assertMockModeSafe,
  getDatabaseModeLabel,
} = require('./config/env');
const { closePool } = require('./config/database');
const { closeMcpClient, connectMcpClient } = require('./mcp/client');

async function start() {
  // Refuse to run mock SQL data in production.
  assertMockModeSafe();
  console.log(`[api] Database mode: ${getDatabaseModeLabel()}`);

  for (const warning of getStartupWarnings()) {
    console.warn(`[api] ${warning}`);
  }

  const allowlistMissing = assertAllowlistConfigured();
  if (allowlistMissing.length > 0) {
    console.warn(
      `[api] ${allowlistMissing.join(', ')} is empty. Procedure endpoints will return a configuration error until set.`
    );
  }

  // Try to connect to the MCP server early. Requests can still retry later if this fails.
  try {
    await connectMcpClient();
    console.log(`[api] Connected to MCP server at ${env.mcpServerUrl}`);
  } catch (error) {
    console.warn(`[api] MCP server not reachable yet (${error.message}). Requests will retry.`);
  }

  const server = app.listen(env.port, () => {
    console.log(`Express API running on http://localhost:${env.port}`);
  });

  async function shutdown(signal) {
    console.log(`Shutting down API (${signal})...`);
    server.close();
    await closeMcpClient();
    await closePool();
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((error) => {
  console.error('Failed to start API:', error.message);
  process.exit(1);
});
