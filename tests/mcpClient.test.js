const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseToolResult } = require('../src/mcp/toolResult');

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
