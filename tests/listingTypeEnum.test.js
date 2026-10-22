const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

describe('dbo.GetLoveableAPIListings listing_type enum rules', () => {
  let validateParameters;
  let executeStoredProcedure;
  let clearMetadataCache;

  before(() => {
    process.env.NODE_ENV = 'development';
    process.env.MOCK_DATABASE = 'true';
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
      '../src/config/businessRules',
      '../src/config/database',
      '../src/mocks/mockDatabase',
      '../src/services/procedureMetadata',
      '../src/services/parameterValidator',
      '../src/services/procedureExecutor',
    ];
    for (const id of reload) {
      delete require.cache[require.resolve(id)];
    }

    ({ validateParameters } = require('../src/services/parameterValidator'));
    ({ executeStoredProcedure } = require('../src/services/procedureExecutor'));
    ({ clearMetadataCache } = require('../src/services/procedureMetadata'));
    clearMetadataCache();
  });

  it('accepts sale', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      minBed: 1,
      maxBed: 2,
    });
    assert.equal(result.valid, true);
    assert.equal(result.normalizedParameters.listing_type, 'sale');
  });

  it('accepts rental', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'rental',
    });
    assert.equal(result.valid, true);
    assert.equal(result.normalizedParameters.listing_type, 'rental');
  });

  it('rejects sales with INVALID_VALUE (no silent conversion)', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sales',
    });
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.parameter === 'listing_type' && e.code === 'INVALID_VALUE')
    );
  });

  it('rejects rent with INVALID_VALUE (no silent conversion)', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'rent',
    });
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.parameter === 'listing_type' && e.code === 'INVALID_VALUE')
    );
  });

  it('rejects hello with INVALID_VALUE', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'hello',
    });
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.parameter === 'listing_type' && e.code === 'INVALID_VALUE')
    );
  });

  it('rejects empty string with INVALID_VALUE', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: '',
    });
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.parameter === 'listing_type' && e.code === 'INVALID_VALUE')
    );
  });

  it('rejects null with REQUIRED when listing_type is required', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: null,
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.parameter === 'listing_type' && e.code === 'REQUIRED'));
  });

  it('blocks mock execution when listing_type is invalid', async () => {
    const result = await executeStoredProcedure('dbo.GetLoveableAPIListings', {
      listing_type: 'sales',
      minBed: 1,
      maxBed: 2,
    });
    assert.equal(result.executed, false);
    assert.equal(result.success, false);
    assert.ok(
      result.errors.some((e) => e.parameter === 'listing_type' && e.code === 'INVALID_VALUE')
    );
  });

  it('allows mock execution when listing_type is sale', async () => {
    const result = await executeStoredProcedure('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      minBed: 1,
      maxBed: 2,
    });
    assert.equal(result.success, true);
    assert.equal(result.executed, true);
  });
});
