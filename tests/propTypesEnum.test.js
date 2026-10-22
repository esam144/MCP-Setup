const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const LISTINGS_RULES = {
  'dbo.GetLoveableAPIListings': {
    required: ['listing_type'],
    enums: {
      listing_type: ['sale', 'rental'],
    },
    multiValueParams: ['propTypes'],
    pairs: [
      { min: 'minBed', max: 'maxBed' },
      { min: 'minSqFt', max: 'maxSqFt' },
    ],
  },
};

describe('GetLoveableAPIListings propTypes open multi-value filters', () => {
  let validateParameters;
  let executeStoredProcedure;
  let clearMetadataCache;
  let isMockDatabase;

  before(() => {
    process.env.NODE_ENV = 'development';
    process.env.MOCK_DATABASE = 'true';
    process.env.ALLOWED_PROCEDURES =
      'dbo.GetLoveableAPIListings,dbo.GetLoveableAPIAgentRoster';
    process.env.BUSINESS_RULES_JSON = JSON.stringify(LISTINGS_RULES);

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

    ({ isMockDatabase } = require('../src/config/database'));
    ({ clearMetadataCache } = require('../src/services/procedureMetadata'));
    ({ validateParameters } = require('../src/services/parameterValidator'));
    ({ executeStoredProcedure } = require('../src/services/procedureExecutor'));
    clearMetadataCache();
  });

  it('accepts propTypes Condo', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      propTypes: 'Condo',
    });
    assert.equal(result.valid, true);
    assert.equal(result.normalizedParameters.propTypes, 'Condo');
  });

  it('accepts propTypes Apartment even when not in any hardcoded allowlist', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      propTypes: 'Apartment',
    });
    assert.equal(result.valid, true);
    assert.equal(result.normalizedParameters.propTypes, 'Apartment');
  });

  it('accepts comma-separated Condo, Apartment, Commercial', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      propTypes: 'Condo, Apartment, Commercial',
    });
    assert.equal(result.valid, true);
    assert.equal(result.normalizedParameters.propTypes, 'Condo, Apartment, Commercial');
  });

  it('trims whitespace around comma-separated propTypes values', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      propTypes: '  Condo ,  Apartment  ',
    });
    assert.equal(result.valid, true);
    assert.equal(result.normalizedParameters.propTypes, 'Condo, Apartment');
  });

  it('rejects empty propTypes string', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      propTypes: '',
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.parameter === 'propTypes'));
  });

  it('rejects empty comma-separated entries', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      propTypes: 'Condo,,Apartment',
    });
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.parameter === 'propTypes' && e.code === 'INVALID_VALUE')
    );
  });

  it('rejects non-string propTypes values', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      propTypes: 42,
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.parameter === 'propTypes'));
  });

  it('preserves listing_type sale|rental only', async () => {
    const ok = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'rental',
      propTypes: 'Condo',
    });
    assert.equal(ok.valid, true);

    const bad = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sales',
      propTypes: 'Condo',
    });
    assert.equal(bad.valid, false);
    assert.ok(bad.errors.some((e) => e.parameter === 'listing_type' && e.code === 'INVALID_VALUE'));
  });

  it('allows mock execution with multi propTypes after validation', async () => {
    assert.equal(isMockDatabase(), true);
    const result = await executeStoredProcedure('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      propTypes: 'Condo, Apartment, Commercial',
    });
    assert.equal(result.success, true);
    assert.equal(result.mock, true);
    assert.equal(result.result.parametersEcho.propTypes, 'Condo, Apartment, Commercial');
  });
});

describe('GetLoveableAPIListings propTypes against real SQL when available', () => {
  it('returns matching rows for known types and zero rows for unknown types', async () => {
    process.env.MOCK_DATABASE = 'false';
    delete require.cache[require.resolve('../src/config/env')];
    delete require.cache[require.resolve('../src/config/database')];
    delete require.cache[require.resolve('../src/config/businessRules')];

    process.env.BUSINESS_RULES_JSON = JSON.stringify(LISTINGS_RULES);

    const { isMockDatabase, getPool, closePool } = require('../src/config/database');
    if (isMockDatabase()) {
      return;
    }

    let pool;
    try {
      pool = await getPool();
    } catch {
      // SQL Server not reachable in this environment — skip live assertions.
      return;
    }

    try {
      const fs = require('fs');
      const path = require('path');
      const sqlText = fs.readFileSync(
        path.join(__dirname, '../scripts/sql/bootstrapSchema.sql'),
        'utf8'
      );
      const batches = sqlText.split(/\r?\nGO\s*\r?\n/i).map((b) => b.trim()).filter(Boolean);
      for (const batch of batches) {
        await pool.request().query(batch);
      }

      const condo = await pool
        .request()
        .input('listing_type', require('mssql').VarChar(50), 'sale')
        .input('propTypes', require('mssql').VarChar(200), 'Condo')
        .execute('dbo.GetLoveableAPIListings');
      assert.ok((condo.recordset || []).length > 0);
      assert.ok((condo.recordset || []).every((row) => row.propTypes === 'Condo'));

      const both = await pool
        .request()
        .input('listing_type', require('mssql').VarChar(50), 'sale')
        .input('propTypes', require('mssql').VarChar(200), 'Condo, Single Family')
        .execute('dbo.GetLoveableAPIListings');
      const bothRows = both.recordset || [];
      assert.ok(bothRows.length > 0);
      const types = new Set(bothRows.map((row) => row.propTypes));
      assert.ok(types.has('Condo'));
      assert.ok(types.has('Single Family'));

      // Unknown type is not a validation error at SQL — zero matching rows.
      const unknown = await pool
        .request()
        .input('listing_type', require('mssql').VarChar(50), 'sale')
        .input('propTypes', require('mssql').VarChar(200), 'Commercial')
        .execute('dbo.GetLoveableAPIListings');
      assert.ok(Array.isArray(unknown.recordset));
      assert.equal((unknown.recordset || []).length, 0);
    } finally {
      await closePool();
    }
  });
});
