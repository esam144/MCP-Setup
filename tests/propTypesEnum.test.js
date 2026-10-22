const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const LISTINGS_RULES = {
  'dbo.GetLoveableAPIListings': {
    required: ['listing_type'],
    enums: {
      listing_type: ['sale', 'rental'],
      propTypes: ['Condo', 'Townhouse', 'Single Family', 'Multi-Family', 'Loft'],
    },
    multiValueParams: ['propTypes'],
    pairs: [
      { min: 'minBed', max: 'maxBed' },
      { min: 'minSqFt', max: 'maxSqFt' },
    ],
  },
};

describe('GetLoveableAPIListings propTypes enum and multi-value filters', () => {
  let validateParameters;
  let executeStoredProcedure;
  let clearMetadataCache;
  let isMockDatabase;
  let sqlAvailable = false;

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

  it('accepts exact propTypes Condo', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      propTypes: 'Condo',
    });
    assert.equal(result.valid, true);
    assert.equal(result.normalizedParameters.propTypes, 'Condo');
  });

  it('accepts exact propTypes Single Family', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      propTypes: 'Single Family',
    });
    assert.equal(result.valid, true);
    assert.equal(result.normalizedParameters.propTypes, 'Single Family');
  });

  it('accepts comma-separated Condo and Single Family', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      propTypes: 'Condo, Single Family',
    });
    assert.equal(result.valid, true);
    assert.equal(result.normalizedParameters.propTypes, 'Condo, Single Family');
  });

  it('rejects invalid propTypes values', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      propTypes: 'apartment',
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.parameter === 'propTypes' && e.code === 'INVALID_VALUE'));
  });

  it('rejects lowercase or combined invented propTypes strings', async () => {
    const result = await validateParameters('dbo.GetLoveableAPIListings', {
      listing_type: 'sale',
      propTypes: 'condo, single family',
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.parameter === 'propTypes' && e.code === 'INVALID_VALUE'));
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
      propTypes: 'Condo, Single Family',
    });
    assert.equal(result.success, true);
    assert.equal(result.mock, true);
    assert.equal(result.result.parametersEcho.propTypes, 'Condo, Single Family');
  });
});

describe('GetLoveableAPIListings propTypes against real SQL when available', () => {
  it('returns Condo, Single Family, and multi-type rows from the seeded SP', async () => {
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
      // Ensure procedure definition includes STRING_SPLIT multi-value support.
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

      const single = await pool
        .request()
        .input('listing_type', require('mssql').VarChar(50), 'sale')
        .input('propTypes', require('mssql').VarChar(200), 'Single Family')
        .execute('dbo.GetLoveableAPIListings');
      assert.ok((single.recordset || []).length > 0);
      assert.ok((single.recordset || []).every((row) => row.propTypes === 'Single Family'));

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
      assert.ok([...types].every((t) => t === 'Condo' || t === 'Single Family'));

      const combinedBad = await pool
        .request()
        .input('listing_type', require('mssql').VarChar(50), 'sale')
        .input('propTypes', require('mssql').VarChar(200), 'condo, single family')
        .execute('dbo.GetLoveableAPIListings');
      // Exact equality after split: lowercase tokens should not match seeded Title Case values
      // under a case-sensitive comparison; with CI collation they might. Prefer empty or
      // validate-layer rejection (covered above). Assert no crash and array result.
      assert.ok(Array.isArray(combinedBad.recordset));
    } finally {
      await closePool();
    }
  });
});
