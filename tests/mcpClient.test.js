const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseToolResult } = require('../src/mcp/toolResult');
const { isMcpRequestTimeout } = require('../src/mcp/client');

describe('MCP tool result parsing', () => {
  it('parses structuredContent', () => {
    const parsed = parseToolResult({ structuredContent: { ok: true }, content: [] });
    assert.deepEqual(parsed, { ok: true });
  });

  it('parses text JSON content', () => {
    const parsed = parseToolResult({
      content: [{ type: 'text', text: '{"valid":true}' }],
    });
    assert.deepEqual(parsed, { valid: true });
  });

  it('throws on empty results', () => {
    assert.throws(() => parseToolResult(null), (err) => err.code === 'MCP_EMPTY_RESULT');
  });
});

describe('MCP request timeout detection', () => {
  it('detects SDK RequestTimeout code -32001', () => {
    assert.equal(isMcpRequestTimeout({ code: -32001, message: 'Request timed out' }), true);
  });

  it('detects wrapped MCP error -32001 message', () => {
    assert.equal(
      isMcpRequestTimeout({ message: 'MCP error -32001: Request timed out' }),
      true
    );
  });

  it('ignores unrelated errors', () => {
    assert.equal(isMcpRequestTimeout({ code: 'MCP_CONNECTION_FAILED' }), false);
  });
});

describe('MCP tool timeout budget vs Gemini', () => {
  it('derives mcpToolTimeoutMs greater than a single Gemini attempt', () => {
    process.env.GEMINI_TIMEOUT_MS = '90000';
    process.env.GEMINI_MAX_RETRIES = '1';
    delete process.env.MCP_TOOL_TIMEOUT_MS;
    delete require.cache[require.resolve('../src/config/env')];
    const { env } = require('../src/config/env');
    // (90000 + 5s app + 10s overhead) * 2 attempts = 210000
    assert.ok(env.mcpToolTimeoutMs > env.geminiTimeoutMs);
    assert.ok(env.mcpToolTimeoutMs >= 180000);
  });
});
