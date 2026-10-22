const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { listingsMetadata } = require('./helpers/mockMetadata');

process.env.ALLOWED_PROCEDURES = 'dbo.GetLoveableAPIListings';
process.env.BUSINESS_RULES_JSON = JSON.stringify({
  'dbo.GetLoveableAPIListings': {
    required: ['listing_type'],
    enums: { listing_type: ['sale', 'rental'] },
  },
});

describe('procedureExecutor security gates', () => {
  let executeStoredProcedure;
  let metadataModule;
  let originalGet;

  before(() => {
    delete require.cache[require.resolve('../src/config/env')];
    delete require.cache[require.resolve('../src/config/businessRules')];
    delete require.cache[require.resolve('../src/services/procedureMetadata')];
    delete require.cache[require.resolve('../src/services/parameterValidator')];
    delete require.cache[require.resolve('../src/services/procedureExecutor')];

    metadataModule = require('../src/services/procedureMetadata');
    originalGet = metadataModule.getProcedureMetadata;
    metadataModule.getProcedureMetadata = async () => listingsMetadata();

    ({ executeStoredProcedure } = require('../src/services/procedureExecutor'));
  });

  after(() => {
    if (metadataModule && originalGet) {
      metadataModule.getProcedureMetadata = originalGet;
    }
  });

  it('prevents execution when validation fails', async () => {
    const result = await executeStoredProcedure('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      minBed: 'hello',
    });
    assert.equal(result.executed, false);
    assert.equal(result.success, false);
    assert.ok(result.errors.some((e) => e.code === 'INVALID_TYPE'));
  });

  it('rejects procedures outside the allowlist before SQL', async () => {
    const result = await executeStoredProcedure('dbo.NotAllowed', { listing_type: 'sale' });
    assert.equal(result.executed, false);
    assert.ok(result.errors.some((e) => e.code === 'PROCEDURE_NOT_ALLOWED'));
  });

  it('quoteIdent escapes brackets safely', () => {
    const { quoteIdent } = require('../src/services/procedureExecutor');
    assert.equal(quoteIdent('dbo'), '[dbo]');
    assert.equal(quoteIdent('na]me'), '[na]]me]');
  });
});
