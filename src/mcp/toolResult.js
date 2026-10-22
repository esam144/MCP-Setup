// Helpers for packaging and reading MCP tool responses.
// MCP tools return content blocks; we also attach structuredContent for convenience.

function toolSuccess(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

function toolFailure(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
    isError: true,
  };
}

function parseToolResult(result) {
  if (!result) {
    const error = new Error('Empty MCP tool result');
    error.code = 'MCP_EMPTY_RESULT';
    error.status = 502;
    throw error;
  }

  // Prefer structuredContent when the SDK provides it.
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent;
  }

  // Fall back to the first text content block.
  let textBlock = null;
  if (result.content && Array.isArray(result.content)) {
    for (const block of result.content) {
      if (block.type === 'text') {
        textBlock = block;
        break;
      }
    }
  }

  if (textBlock && textBlock.text) {
    try {
      return JSON.parse(textBlock.text);
    } catch (cause) {
      const error = new Error('MCP tool returned non-JSON content');
      error.code = 'MCP_INVALID_RESULT';
      error.status = 502;
      error.cause = cause;
      throw error;
    }
  }

  const error = new Error('MCP tool returned no usable content');
  error.code = 'MCP_INVALID_RESULT';
  error.status = 502;
  throw error;
}

module.exports = {
  toolSuccess,
  toolFailure,
  parseToolResult,
};
