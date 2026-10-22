const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { safeParseJson } = require('../src/services/geminiService');

describe('geminiService JSON handling', () => {
  it('rejects malformed JSON from Gemini', () => {
    assert.throws(
      () => safeParseJson('not-json{'),
      (err) => err.code === 'GEMINI_MALFORMED_JSON'
    );
  });

  it('parses valid JSON', () => {
    assert.deepEqual(safeParseJson('{"a":1}'), { a: 1 });
  });
});

describe('gemini unauthorized procedure suggestion', () => {
  it('flags unauthorized procedure suggestions via allowlist check shape', async () => {
    // Unit-level: interpret path checks allowlist membership.
    process.env.ALLOWED_PROCEDURES = 'dbo.GetLoveableAPIListings';
    delete require.cache[require.resolve('../src/config/env')];
    const { env, normalizeProcedureName } = require('../src/config/env');
    const suggested = 'dbo.EvilProc';
    const allowed = env.allowedProcedures;
    assert.equal(allowed.includes(normalizeProcedureName(suggested)), false);
  });
});
