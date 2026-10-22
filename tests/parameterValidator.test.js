const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const { listingsMetadata } = require('./helpers/mockMetadata');

process.env.ALLOWED_PROCEDURES = 'dbo.GetLoveableAPIListings,dbo.GetLoveableAPIAgentRoster';
process.env.BUSINESS_RULES_JSON = JSON.stringify({
  'dbo.GetLoveableAPIListings': {
    required: ['listing_type'],
    enums: { listing_type: ['sale', 'rental'] },
    pairs: [
      { min: 'minBed', max: 'maxBed' },
      { min: 'minSqFt', max: 'maxSqFt' },
    ],
    ranges: { minBed: { min: 0, max: 20 }, maxBed: { min: 0, max: 20 }, minSqFt: { min: 0 }, maxSqFt: { min: 0 } },
  },
});

describe('parameterValidator', () => {
  let validateParameters;
  let metadataModule;
  let originalGet;

  before(async () => {
    // Fresh module load with env set
    delete require.cache[require.resolve('../src/config/env')];
    delete require.cache[require.resolve('../src/config/businessRules')];
    delete require.cache[require.resolve('../src/services/procedureMetadata')];
    delete require.cache[require.resolve('../src/services/parameterValidator')];

    metadataModule = require('../src/services/procedureMetadata');
    originalGet = metadataModule.getProcedureMetadata;
    metadataModule.getProcedureMetadata = async (name) => {
      const normalized = String(name).toLowerCase();
      if (normalized.includes('getloveableapilistings')) {
        return listingsMetadata();
      }
      const err = new Error(`Stored procedure not found: ${name}`);
      err.code = 'PROCEDURE_NOT_FOUND';
      err.status = 404;
      throw err;
    };

    ({ validateParameters } = require('../src/services/parameterValidator'));
  });

  after(() => {
    if (metadataModule && originalGet) {
      metadataModule.getProcedureMetadata = originalGet;
    }
    mock.restoreAll();
  });

  it('accepts a valid integer parameter', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      minBed: 2,
      maxBed: 5,
    });
    assert.equal(result.valid, true);
    assert.equal(result.normalizedParameters.minBed, 2);
    assert.deepEqual(result.errors, []);
  });

  it('rejects an invalid integer parameter', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      minBed: 'hello',
      maxBed: 5,
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.parameter === 'minBed' && e.code === 'INVALID_TYPE'));
  });

  it('rejects an unknown parameter name', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      unknownThing: 1,
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === 'UNKNOWN_PARAMETER'));
  });

  it('rejects a missing required parameter when configured', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      minBed: 1,
      maxBed: 2,
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === 'REQUIRED' && e.parameter === 'listing_type'));
  });

  it('accepts a valid decimal parameter', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      price: '1234.56',
    });
    assert.equal(result.valid, true);
    assert.equal(result.normalizedParameters.price, 1234.56);
  });

  it('accepts an explicit null value', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      minBed: null,
    });
    assert.equal(result.valid, true);
    assert.equal(result.normalizedParameters.minBed, null);
  });

  it('rejects a string exceeding permitted length', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      notes: 'abcdefghijk',
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === 'STRING_TOO_LONG'));
  });

  it('rejects an unknown stored procedure', async () => {
    const result = await validateParameters('dbo.DoesNotExist', { listing_type: 'sale' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === 'PROCEDURE_NOT_ALLOWED'));
  });

  it('rejects a procedure that is not on the allowlist', async () => {
    const result = await validateParameters('dbo.SecretProc', {});
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === 'PROCEDURE_NOT_ALLOWED'));
  });

  it('rejects minimum greater than maximum when the rule exists', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      minBed: 5,
      maxBed: 2,
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === 'MIN_GREATER_THAN_MAX'));
  });

  it('accepts mls, propTypes, and integer square-footage filters', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      mls: 'ABC123',
      propTypes: 'Single Family',
      minSqFt: 1000,
      maxSqFt: 2000,
    });
    assert.equal(result.valid, true);
    assert.equal(result.normalizedParameters.mls, 'ABC123');
    assert.equal(result.normalizedParameters.propTypes, 'Single Family');
    assert.equal(result.normalizedParameters.minSqFt, 1000);
    assert.equal(result.normalizedParameters.maxSqFt, 2000);
  });

  it('rejects square-footage range when minSqFt exceeds maxSqFt', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      minSqFt: 5000,
      maxSqFt: 1000,
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === 'MIN_GREATER_THAN_MAX'));
  });
});
