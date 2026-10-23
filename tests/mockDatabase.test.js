const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

describe('mock database mode', () => {
  let getProcedureMetadata;
  let validateParameters;
  let executeStoredProcedure;
  let getPool;
  let wasRealConnectAttempted;
  let isMockDatabase;
  let assertMockModeSafe;
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
    // Intentionally leave SQL credentials empty — mock mode must not need them.
    delete process.env.SQL_SERVER;
    delete process.env.SQL_DATABASE;
    delete process.env.SQL_USER;
    delete process.env.SQL_PASSWORD;

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

    ({ assertMockModeSafe } = require('../src/config/env'));
    ({ getPool, wasRealConnectAttempted, isMockDatabase } = require('../src/config/database'));
    ({ getProcedureMetadata, clearMetadataCache } = require('../src/services/procedureMetadata'));
    ({ validateParameters } = require('../src/services/parameterValidator'));
    ({ executeStoredProcedure } = require('../src/services/procedureExecutor'));
    clearMetadataCache();
  });

  it('enables mock mode without SQL Server credentials', () => {
    assert.equal(isMockDatabase(), true);
    assert.doesNotThrow(() => assertMockModeSafe());
  });

  it('does not create a real SQL Server connection in mock mode', async () => {
    await assert.rejects(() => getPool(), (err) => err.code === 'MOCK_DATABASE_ACTIVE');
    assert.equal(wasRealConnectAttempted(), false);
  });

  it('discovers mock metadata for listings', async () => {
    const metadata = await getProcedureMetadata('dbo.GetLoveableAPIListings');
    assert.equal(metadata.mock, true);
    assert.equal(metadata.qualifiedName, 'dbo.GetLoveableAPIListings');
    const names = metadata.parameters.map((p) => p.name.replace(/^@/, ''));
    assert.deepEqual(names, [
      'listing_type',
      'mls',
      'propTypes',
      'minBed',
      'maxBed',
      'minBath',
      'maxBath',
      'minSqFt',
      'maxSqFt',
    ]);
  });

  it('accepts valid integer and decimal parameters', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      minBed: 2,
      maxBed: 5,
      minBath: '1.5',
      maxBath: 3.0,
    });
    assert.equal(result.valid, true);
    assert.equal(result.normalizedParameters.minBed, 2);
    assert.equal(result.normalizedParameters.minBath, 1.5);
  });

  it('rejects invalid integer values such as hello', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      minBed: 'hello',
      maxBed: 5,
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.parameter === 'minBed' && e.code === 'INVALID_TYPE'));
  });

  it('rejects unknown parameter names', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      notARealParam: 1,
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === 'UNKNOWN_PARAMETER'));
  });

  it('rejects unknown / non-allowlisted procedures', async () => {
    const result = await validateParameters('dbo.SecretProc', {});
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === 'PROCEDURE_NOT_ALLOWED'));
  });

  it('defaults omitted listing_type to sale when that parameter exists', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      minBed: 1,
      maxBed: 2,
    });
    assert.equal(result.valid, true);
    assert.equal(result.normalizedParameters.listing_type, 'sale');
  });

  it('rejects explicit null listing_type as REQUIRED', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: null,
      minBed: 1,
      maxBed: 2,
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === 'REQUIRED' && e.parameter === 'listing_type'));
  });

  it('accepts explicit NULL values', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      minBed: null,
    });
    assert.equal(result.valid, true);
    assert.equal(result.normalizedParameters.minBed, null);
  });

  it('rejects minimum greater than maximum when the rule exists', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      minBed: 8,
      maxBed: 2,
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === 'MIN_GREATER_THAN_MAX'));
  });

  it('returns labelled mock execution and never hits SQL', async () => {
    const result = await executeStoredProcedure('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      minBed: 2,
      maxBed: 4,
    });
    assert.equal(result.success, true);
    assert.equal(result.mock, true);
    assert.equal(result.executed, true);
    assert.match(result.message, /No SQL Server query was executed/);
    assert.equal(wasRealConnectAttempted(), false);
  });

  it('rejects invalid inputs before mock execution', async () => {
    const result = await executeStoredProcedure('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      minBed: 'nope',
    });
    assert.equal(result.executed, false);
    assert.equal(result.success, false);
    assert.ok(result.errors.some((e) => e.code === 'INVALID_TYPE'));
  });

  it('forbids mock mode in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.MOCK_DATABASE = 'true';
    delete require.cache[require.resolve('../src/config/env')];
    const { assertMockModeSafe: assertProd } = require('../src/config/env');
    assert.throws(() => assertProd(), (err) => err.code === 'MOCK_DATABASE_FORBIDDEN_IN_PRODUCTION');

    // Restore for any later tests in this worker.
    process.env.NODE_ENV = 'development';
  });
});

describe('mock mode is not a silent fallback', () => {
  it('stays off when MOCK_DATABASE=false (SQL failures do not flip into mock mode)', () => {
    // dotenv will not override an explicit false once set.
    process.env.MOCK_DATABASE = 'false';
    process.env.NODE_ENV = 'development';
    delete require.cache[require.resolve('../src/config/env')];
    delete require.cache[require.resolve('../src/config/database')];
    const { env } = require('../src/config/env');
    const { isMockDatabase } = require('../src/config/database');
    assert.equal(env.mockDatabase, false);
    assert.equal(isMockDatabase(), false);
  });
});
