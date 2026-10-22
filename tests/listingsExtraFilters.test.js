const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

describe('GetLoveableAPIListings mls / propTypes / sqFt filters', () => {
  let validateParameters;
  let executeStoredProcedure;
  let getProcedureMetadata;
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
        ranges: {
          minBed: { min: 0, max: 20 },
          maxBed: { min: 0, max: 20 },
          minSqFt: { min: 0 },
          maxSqFt: { min: 0 },
        },
      },
    });

    const modulesToReload = [
      '../src/config/env',
      '../src/config/businessRules',
      '../src/config/database',
      '../src/mocks/mockDatabase',
      '../src/services/procedureMetadata',
      '../src/services/parameterValidator',
      '../src/services/procedureExecutor',
    ];
    for (const id of modulesToReload) {
      delete require.cache[require.resolve(id)];
    }

    ({ getProcedureMetadata, clearMetadataCache } = require('../src/services/procedureMetadata'));
    ({ validateParameters } = require('../src/services/parameterValidator'));
    ({ executeStoredProcedure } = require('../src/services/procedureExecutor'));
    clearMetadataCache();
  });

  it('exposes mls, propTypes, minSqFt, and maxSqFt in mock metadata', async () => {
    const metadata = await getProcedureMetadata('dbo.GetLoveableAPIListings');
    const byName = Object.fromEntries(
      metadata.parameters.map((p) => [p.name.replace(/^@/, ''), p.sqlType])
    );
    assert.equal(byName.mls, 'varchar');
    assert.equal(byName.propTypes, 'varchar');
    assert.equal(byName.minSqFt, 'int');
    assert.equal(byName.maxSqFt, 'int');
  });

  it('accepts optional mls and propTypes strings with listing_type only', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      mls: 'A1234567',
      propTypes: 'Condo',
    });
    assert.equal(result.valid, true);
    assert.equal(result.normalizedParameters.mls, 'A1234567');
    assert.equal(result.normalizedParameters.propTypes, 'Condo');
  });

  it('accepts optional integer square-footage range', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'rental',
      minSqFt: 800,
      maxSqFt: 2500,
    });
    assert.equal(result.valid, true);
    assert.equal(result.normalizedParameters.minSqFt, 800);
    assert.equal(result.normalizedParameters.maxSqFt, 2500);
  });

  it('allows omitting all four filters', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
    });
    assert.equal(result.valid, true);
    assert.equal(result.normalizedParameters.mls, undefined);
    assert.equal(result.normalizedParameters.minSqFt, undefined);
  });

  it('rejects non-integer minSqFt (decimal)', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      minSqFt: 1000.5,
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.parameter === 'minSqFt' && e.code === 'INVALID_TYPE'));
  });

  it('rejects non-integer maxSqFt (string)', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      maxSqFt: 'large',
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.parameter === 'maxSqFt' && e.code === 'INVALID_TYPE'));
  });

  it('rejects minSqFt greater than maxSqFt', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      minSqFt: 3000,
      maxSqFt: 1000,
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === 'MIN_GREATER_THAN_MAX'));
  });

  it('rejects non-string mls', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      mls: 12345,
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.parameter === 'mls' && e.code === 'INVALID_TYPE'));
  });

  it('preserves listing_type enum while accepting new filters', async () => {
    const bad = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sales',
      mls: 'X1',
      propTypes: 'House',
      minSqFt: 500,
      maxSqFt: 2000,
    });
    assert.equal(bad.valid, false);
    assert.ok(bad.errors.some((e) => e.parameter === 'listing_type' && e.code === 'INVALID_VALUE'));
  });

  it('passes new filters through mock execution after validation', async () => {
    const result = await executeStoredProcedure('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      mls: 'MLS-99',
      propTypes: 'Townhouse',
      minSqFt: 1200,
      maxSqFt: 2200,
    });
    assert.equal(result.success, true);
    assert.equal(result.mock, true);
    assert.equal(result.result.parametersEcho.mls, 'MLS-99');
    assert.equal(result.result.parametersEcho.propTypes, 'Townhouse');
    assert.equal(result.result.parametersEcho.minSqFt, 1200);
    assert.equal(result.result.parametersEcho.maxSqFt, 2200);
    assert.match(result.message, /No SQL Server query was executed/);
  });
});
