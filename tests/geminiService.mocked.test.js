const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

/**
 * These tests MOCK the Gemini SDK generateContent call.
 * They do NOT call the real Gemini API.
 */

describe('geminiService mocked error handling (no live Gemini)', () => {
  let classifyGeminiError;
  let generateJson;
  let setGenerateContentOverride;
  let clearGenerateContentOverride;
  let interpretRequest;

  before(() => {
    process.env.NODE_ENV = 'development';
    process.env.MOCK_DATABASE = 'true';
    process.env.GEMINI_API_KEY = 'test-key-not-real';
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    process.env.GEMINI_TIMEOUT_MS = '30000';
    process.env.GEMINI_MAX_RETRIES = '1';
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

    const reload = [
      '../src/config/env',
      '../src/config/gemini',
      '../src/config/businessRules',
      '../src/config/database',
      '../src/mocks/mockDatabase',
      '../src/services/procedureMetadata',
      '../src/services/parameterValidator',
      '../src/services/geminiService',
    ];
    for (const id of reload) {
      delete require.cache[require.resolve(id)];
    }

    ({
      classifyGeminiError,
      generateJson,
      setGenerateContentOverride,
      clearGenerateContentOverride,
      interpretRequest,
    } = require('../src/services/geminiService'));
  });

  after(() => {
    clearGenerateContentOverride();
  });

  beforeEach(() => {
    clearGenerateContentOverride();
  });

  it('classifies timeout errors', () => {
    const error = new Error('Gemini request timed out after 30000ms');
    error.code = 'GEMINI_TIMEOUT';
    const classified = classifyGeminiError(error);
    assert.equal(classified.code, 'GEMINI_TIMEOUT');
    assert.equal(classified.status, 503);
    assert.equal(classified.retryable, true);
  });

  it('classifies rate limit errors', () => {
    const error = new Error(
      JSON.stringify({ error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } })
    );
    error.status = 429;
    const classified = classifyGeminiError(error);
    assert.equal(classified.code, 'GEMINI_RATE_LIMITED');
    assert.equal(classified.status, 429);
  });

  it('classifies invalid credentials', () => {
    const error = new Error(
      JSON.stringify({ error: { code: 403, message: 'API key not valid', status: 'PERMISSION_DENIED' } })
    );
    error.status = 403;
    const classified = classifyGeminiError(error);
    assert.equal(classified.code, 'GEMINI_AUTH_FAILED');
  });

  it('classifies unavailable service', () => {
    const error = new Error(
      JSON.stringify({
        error: {
          code: 503,
          message: 'This model is currently experiencing high demand.',
          status: 'UNAVAILABLE',
        },
      })
    );
    error.status = 503;
    const classified = classifyGeminiError(error);
    assert.equal(classified.code, 'GEMINI_UNAVAILABLE');
    assert.equal(classified.retryable, true);
  });

  it('returns success JSON from a mocked Gemini response', async () => {
    setGenerateContentOverride(async () => ({
      text: JSON.stringify({ hello: true }),
    }));
    const result = await generateJson('prompt', {
      type: 'object',
      properties: { hello: { type: 'boolean' } },
      required: ['hello'],
    });
    assert.deepEqual(result, { hello: true });
  });

  it('maps a mocked timeout into interpretRequest error payload', async () => {
    setGenerateContentOverride(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const error = new Error('simulated hang');
      // Never resolve before app timeout in this unit test — throw timeout-shaped error instead.
      error.code = 'GEMINI_TIMEOUT';
      error.status = 503;
      throw error;
    });

    // Force generateJson path: override already throws GEMINI_TIMEOUT.
    const result = await interpretRequest('Find sale listings with 2 bedrooms');
    assert.equal(result.success, false);
    assert.equal(result.errors[0].code, 'GEMINI_TIMEOUT');
    assert.ok(result.clarification);
  });

  it('maps a mocked rate-limit into interpretRequest error payload', async () => {
    setGenerateContentOverride(async () => {
      const error = new Error(
        JSON.stringify({ error: { code: 429, message: 'rate limit', status: 'RESOURCE_EXHAUSTED' } })
      );
      error.status = 429;
      throw error;
    });

    const result = await interpretRequest('Find agents in downtown office');
    assert.equal(result.success, false);
    assert.equal(result.errors[0].code, 'GEMINI_RATE_LIMITED');
  });

  it('maps mocked invalid credentials distinctly', async () => {
    setGenerateContentOverride(async () => {
      const error = new Error(
        JSON.stringify({ error: { code: 401, message: 'API key invalid', status: 'UNAUTHENTICATED' } })
      );
      error.status = 401;
      throw error;
    });

    const result = await interpretRequest('Find listings');
    assert.equal(result.errors[0].code, 'GEMINI_AUTH_FAILED');
  });

  it('maps mocked unavailable service distinctly', async () => {
    setGenerateContentOverride(async () => {
      const error = new Error(
        JSON.stringify({
          error: { code: 503, message: 'high demand', status: 'UNAVAILABLE' },
        })
      );
      error.status = 503;
      throw error;
    });

    const result = await interpretRequest('Find listings');
    assert.equal(result.errors[0].code, 'GEMINI_UNAVAILABLE');
  });

  it('retries once on retryable unavailable then succeeds', async () => {
    let calls = 0;
    setGenerateContentOverride(async () => {
      calls += 1;
      if (calls === 1) {
        const error = new Error(
          JSON.stringify({
            error: { code: 503, message: 'high demand', status: 'UNAVAILABLE' },
          })
        );
        error.status = 503;
        throw error;
      }
      return {
        text: JSON.stringify({
          ambiguous: false,
          clarification: null,
          procedure: 'dbo.GetLoveableAPIListings',
          parameters: { listing_type: 'sale', minBed: 2, maxBed: 5 },
          rationale: null,
        }),
      };
    });

    const result = await interpretRequest('Find sale listings with 2 to 5 bedrooms');
    assert.equal(calls, 2);
    assert.equal(result.success, true);
    assert.equal(result.procedure, 'dbo.GetLoveableAPIListings');
  });

  it('accepts Gemini-mapped mls, propTypes, and square-footage parameters', async () => {
    setGenerateContentOverride(async () => ({
      text: JSON.stringify({
        ambiguous: false,
        clarification: null,
        procedure: 'dbo.GetLoveableAPIListings',
        parameters: {
          listing_type: 'sale',
          mls: 'M-7788',
          propTypes: 'Condo',
          minSqFt: 900,
          maxSqFt: 1800,
        },
        rationale: 'Mapped MLS, property type, and sq ft from the request.',
      }),
    }));

    const result = await interpretRequest(
      'Sale condo MLS M-7788 between 900 and 1800 square feet'
    );
    assert.equal(result.success, true);
    assert.equal(result.procedure, 'dbo.GetLoveableAPIListings');
    assert.equal(result.parameters.mls, 'M-7788');
    assert.equal(result.parameters.propTypes, 'Condo');
    assert.equal(result.parameters.minSqFt, 900);
    assert.equal(result.parameters.maxSqFt, 1800);
  });
});
