// MCP client used by Express. Talks to the MCP server over Streamable HTTP.
// Do not call SQL or Gemini directly from routes — go through callMcpTool().

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { env } = require('../config/env');
const { parseToolResult } = require('./toolResult');

// Reuse one shared client so we do not open a new MCP connection per request.
let sharedClient = null;
let connectInProgress = null;

function buildTransport() {
  const url = new URL(env.mcpServerUrl);
  const options = {};

  // Optional shared secret between Express and the MCP server.
  if (env.mcpAuthToken) {
    options.requestInit = {
      headers: {
        Authorization: `Bearer ${env.mcpAuthToken}`,
      },
    };
  }

  return new StreamableHTTPClientTransport(url, options);
}

async function connectMcpClient() {
  if (sharedClient) {
    return sharedClient;
  }

  // If another request is already connecting, wait for that same promise.
  if (connectInProgress) {
    return connectInProgress;
  }

  connectInProgress = doConnect();
  try {
    sharedClient = await connectInProgress;
    return sharedClient;
  } finally {
    connectInProgress = null;
  }
}

async function doConnect() {
  const client = new Client({ name: 'express-api-backend', version: '1.0.0' });
  const transport = buildTransport();

  try {
    await client.connect(transport);
    return client;
  } catch (cause) {
    const error = new Error('Failed to connect to MCP server');
    error.code = 'MCP_CONNECTION_FAILED';
    error.status = 503;
    error.cause = cause;
    throw error;
  }
}

async function closeMcpClient() {
  if (!sharedClient) {
    return;
  }

  try {
    await sharedClient.close();
  } catch {
    // Ignore close errors during shutdown.
  }

  sharedClient = null;
  connectInProgress = null;
}

function isConnectionError(error) {
  const message = error.message || '';
  if (error.code === 'ECONNREFUSED' || error.code === 'MCP_CONNECTION_FAILED') {
    return true;
  }
  if (/ECONNREFUSED|fetch failed|network|socket|connect/i.test(message)) {
    return true;
  }
  return false;
}

// MCP SDK ErrorCode.RequestTimeout === -32001 ("Request timed out").
function isMcpRequestTimeout(error) {
  if (!error) {
    return false;
  }
  if (error.code === -32001 || error.code === 'MCP_REQUEST_TIMEOUT') {
    return true;
  }
  const message = String(error.message || '');
  return /MCP error -32001|Request timed out/i.test(message);
}

async function callMcpTool(toolName, args = {}) {
  const client = await connectMcpClient();
  // Must exceed Gemini SDK timeout × retries; SDK default is only 60s.
  const toolTimeoutMs = env.mcpToolTimeoutMs;

  try {
    const rawResult = await client.callTool(
      {
        name: toolName,
        arguments: args,
      },
      undefined,
      {
        timeout: toolTimeoutMs,
      }
    );

    const parsed = parseToolResult(rawResult);

    // Tool handlers may mark a failed business result with isError.
    if (rawResult.isError) {
      const firstError = parsed && parsed.errors && parsed.errors[0];
      const message =
        (parsed && parsed.error && parsed.error.message) ||
        (firstError && firstError.message) ||
        'MCP tool reported an error';

      const error = new Error(message);
      error.code =
        (parsed && parsed.error && parsed.error.code) ||
        (firstError && firstError.code) ||
        'MCP_TOOL_ERROR';
      error.status = 400;
      error.payload = parsed;
      throw error;
    }

    return parsed;
  } catch (error) {
    // Keep tool business errors as-is (they already have a payload).
    if (error.payload) {
      throw error;
    }

    // Reset the client so the next call can reconnect (drops timed-out session state).
    await closeMcpClient();

    if (isConnectionError(error)) {
      const connectionError = new Error('Failed to connect to MCP server');
      connectionError.code = 'MCP_CONNECTION_FAILED';
      connectionError.status = 503;
      connectionError.cause = error;
      throw connectionError;
    }

    if (isMcpRequestTimeout(error)) {
      const timeoutError = new Error(
        `MCP tool "${toolName}" timed out after ${toolTimeoutMs}ms waiting for the MCP server. The tool may still finish on the server; retry once if needed.`
      );
      timeoutError.code = 'MCP_REQUEST_TIMEOUT';
      timeoutError.status = 504;
      timeoutError.cause = error;
      timeoutError.payload = {
        success: false,
        procedure: null,
        parameters: {},
        errors: [
          {
            parameter: 'mcp',
            code: 'MCP_REQUEST_TIMEOUT',
            message: timeoutError.message,
          },
        ],
        httpStatusHint: 504,
      };
      throw timeoutError;
    }

    const wrapped = new Error(error.message || 'MCP tool call failed');
    wrapped.code = error.code || 'MCP_TOOL_ERROR';
    wrapped.status = error.status || 502;
    wrapped.cause = error;
    throw wrapped;
  }
}

module.exports = {
  connectMcpClient,
  closeMcpClient,
  callMcpTool,
  isMcpRequestTimeout,
};
