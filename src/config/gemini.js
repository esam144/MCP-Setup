// Shared Google Gemini client (official @google/genai SDK).

const { GoogleGenAI } = require('@google/genai');
const { env } = require('./env');

let client = null;
let clientTimeoutMs = null;

function getGeminiClient() {
  if (!env.geminiApiKey) {
    const error = new Error('GEMINI_API_KEY is not configured');
    error.code = 'GEMINI_CONFIG_MISSING';
    error.status = 503;
    throw error;
  }

  // Recreate the client if the timeout setting changed.
  if (!client || clientTimeoutMs !== env.geminiTimeoutMs) {
    client = new GoogleGenAI({
      apiKey: env.geminiApiKey,
      // SDK-level HTTP timeout (AbortController). Driven by GEMINI_TIMEOUT_MS (default 90s).
      httpOptions: {
        timeout: env.geminiTimeoutMs,
      },
    });
    clientTimeoutMs = env.geminiTimeoutMs;
  }

  return client;
}

function isGeminiConfigured() {
  return Boolean(env.geminiApiKey);
}

function resetGeminiClientForTests() {
  client = null;
  clientTimeoutMs = null;
}

module.exports = {
  getGeminiClient,
  isGeminiConfigured,
  resetGeminiClientForTests,
  geminiModel: () => env.geminiModel,
  geminiTimeoutMs: () => env.geminiTimeoutMs,
  geminiMaxRetries: () => env.geminiMaxRetries,
};
