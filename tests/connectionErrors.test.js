const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('SQL connection failure handling', () => {
  it('buildConfig fails clearly when SQL env is missing', () => {
    const saved = { ...process.env };
    // Real mode: missing SQL credentials must fail (mock mode would skip this check).
    process.env.MOCK_DATABASE = 'false';
    delete process.env.SQL_SERVER;
    delete process.env.SQL_DATABASE;
    delete process.env.SQL_USER;
    delete process.env.SQL_PASSWORD;
    delete require.cache[require.resolve('../src/config/env')];
    delete require.cache[require.resolve('../src/config/database')];

    const { buildConfig } = require('../src/config/database');
    assert.throws(() => buildConfig(), (err) => err.code === 'SQL_CONFIG_MISSING');

    Object.assign(process.env, saved);
  });
});

describe('MCP connection failure handling', () => {
  it('surfaces MCP_CONNECTION_FAILED when server is unreachable', async () => {
    process.env.MCP_SERVER_URL = 'http://127.0.0.1:59999/mcp';
    process.env.MCP_AUTH_TOKEN = '';
    delete require.cache[require.resolve('../src/config/env')];
    delete require.cache[require.resolve('../src/mcp/client')];

    const { closeMcpClient, callMcpTool } = require('../src/mcp/client');
    await closeMcpClient();
    await assert.rejects(
      () => callMcpTool('list_stored_procedures', {}),
      (err) => err.code === 'MCP_CONNECTION_FAILED' && err.status === 503
    );
  });
});
