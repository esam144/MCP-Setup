const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

describe('procedureMetadata allowlist', () => {
  before(() => {
    process.env.ALLOWED_PROCEDURES = 'dbo.GetLoveableAPIListings,GetLoveableAPIAgentRoster';
    delete require.cache[require.resolve('../src/config/env')];
    delete require.cache[require.resolve('../src/services/procedureMetadata')];
  });

  it('lists only allowlisted procedures without querying SQL', () => {
    const { listAllowedProcedures } = require('../src/services/procedureMetadata');
    const list = listAllowedProcedures();
    assert.equal(list.length, 2);
    assert.ok(list.every((p) => p.qualifiedName.includes('.')));
  });

  it('normalizes unqualified names to dbo', () => {
    const { normalizeProcedureName } = require('../src/services/procedureMetadata');
    assert.equal(normalizeProcedureName('GetLoveableAPIAgentRoster'), 'dbo.getloveableapiagentroster');
  });

  it('rejects when allowlist empty', () => {
    process.env.ALLOWED_PROCEDURES = '';
    delete require.cache[require.resolve('../src/config/env')];
    delete require.cache[require.resolve('../src/services/procedureMetadata')];
    const { ensureAllowlist } = require('../src/services/procedureMetadata');
    assert.throws(() => ensureAllowlist(), (err) => err.code === 'ALLOWLIST_NOT_CONFIGURED');
  });
});
