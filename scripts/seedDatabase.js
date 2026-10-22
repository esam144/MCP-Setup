// Idempotent local seed for MCPDatabase.
// - Bootstraps schema/procedures only if needed (see scripts/sql/bootstrapSchema.sql)
// - Inserts fictional Agents / Listings tagged with SEED-* keys (no duplicates on re-run)
// - Never logs credentials
//
// Usage: npm run seed

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const SEED_AGENT_PREFIX = 'SEED-AGENT-';
const SEED_MLS_PREFIX = 'SEED-MLS-';
const TARGET_LISTINGS = 80;
const TARGET_AGENTS = 12;

const CITIES = [
  { city: 'Austin', state: 'TX' },
  { city: 'Dallas', state: 'TX' },
  { city: 'Houston', state: 'TX' },
  { city: 'Denver', state: 'CO' },
  { city: 'Seattle', state: 'WA' },
  { city: 'Portland', state: 'OR' },
  { city: 'Chicago', state: 'IL' },
  { city: 'Atlanta', state: 'GA' },
];

const PROP_TYPES = ['Condo', 'Townhouse', 'Single Family', 'Multi-Family', 'Loft'];

const AGENT_NAMES = [
  'Ava Mercer',
  'Noah Patel',
  'Maya Chen',
  'Liam Ortega',
  'Sofia Brooks',
  'Ethan Walsh',
  'Harper Nguyen',
  'Owen Ramirez',
  'Isla Bennett',
  'Caleb Foster',
  'Nora Singh',
  'Julian Price',
];

const OFFICE_CODES = ['AUS01', 'DAL02', 'HOU03', 'DEN04', 'SEA05', 'PDX06'];

function splitSqlBatches(sqlText) {
  // Split on lines that contain only GO (standard SSMS batch separator).
  const lines = String(sqlText).split(/\r?\n/);
  const batches = [];
  let current = [];

  for (const line of lines) {
    if (/^\s*GO\s*$/i.test(line)) {
      const batch = current.join('\n').trim();
      if (batch) {
        batches.push(batch);
      }
      current = [];
    } else {
      current.push(line);
    }
  }

  const last = current.join('\n').trim();
  if (last) {
    batches.push(last);
  }
  return batches;
}

function pad(n, width) {
  return String(n).padStart(width, '0');
}

function listingTypeForIndex(i) {
  // Mix sale/rental; only exact values allowed by app + CHECK constraint.
  return i % 3 === 0 ? 'rental' : 'sale';
}

function buildAgentRows() {
  const rows = [];
  for (let i = 1; i <= TARGET_AGENTS; i += 1) {
    const name = AGENT_NAMES[i - 1];
    const office = OFFICE_CODES[(i - 1) % OFFICE_CODES.length];
    rows.push({
      seedKey: `${SEED_AGENT_PREFIX}${pad(i, 2)}`,
      fullName: name,
      officeCode: office,
      email: `${name.toLowerCase().replace(/\s+/g, '.')}@example-realty.test`,
      phone: `555-01${pad(i, 2)}`,
      isActive: i === 11 ? 0 : 1, // one inactive agent for roster filter tests
    });
  }
  return rows;
}

function buildListingRows(agentIdsBySeedKey) {
  const rows = [];
  for (let i = 1; i <= TARGET_LISTINGS; i += 1) {
    const agentSeed = `${SEED_AGENT_PREFIX}${pad(((i - 1) % TARGET_AGENTS) + 1, 2)}`;
    const agentId = agentIdsBySeedKey.get(agentSeed);
    const place = CITIES[(i - 1) % CITIES.length];
    const propType = PROP_TYPES[(i - 1) % PROP_TYPES.length];
    const listingType = listingTypeForIndex(i);
    const beds = (i % 5) + 1;
    const baths = Number(((i % 4) + 1 + (i % 2 === 0 ? 0.5 : 0)).toFixed(2));
    const sqFt = 700 + i * 35;
    const price =
      listingType === 'rental' ? 1200 + i * 45 : 185000 + i * 12500;

    rows.push({
      mlsNumber: `${SEED_MLS_PREFIX}${pad(i, 4)}`,
      listingType,
      propType,
      beds,
      baths,
      sqFt,
      price,
      city: place.city,
      stateCode: place.state,
      addressLine: `${100 + i} Mockingbird Lane`,
      description: `Fictional ${propType.toLowerCase()} for ${listingType} in ${place.city}.`,
      agentId,
      listedAt: `2024-${pad(((i - 1) % 12) + 1, 2)}-${pad(((i - 1) % 28) + 1, 2)}`,
    });
  }
  return rows;
}

async function ensureSchema(pool) {
  const schemaPath = path.join(__dirname, 'sql', 'bootstrapSchema.sql');
  const sqlText = fs.readFileSync(schemaPath, 'utf8');
  const batches = splitSqlBatches(sqlText);

  for (const batch of batches) {
    await pool.request().query(batch);
  }
}

async function seedAgents(transaction) {
  const rows = buildAgentRows();
  let inserted = 0;

  for (const row of rows) {
    const result = await new (require('mssql').Request)(transaction)
      .input('seedKey', require('mssql').NVarChar(64), row.seedKey)
      .input('fullName', require('mssql').NVarChar(200), row.fullName)
      .input('officeCode', require('mssql').VarChar(20), row.officeCode)
      .input('email', require('mssql').NVarChar(200), row.email)
      .input('phone', require('mssql').VarChar(30), row.phone)
      .input('isActive', require('mssql').Bit, row.isActive)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.Agents WHERE SeedKey = @seedKey)
        BEGIN
          INSERT INTO dbo.Agents (SeedKey, FullName, OfficeCode, Email, Phone, IsActive)
          VALUES (@seedKey, @fullName, @officeCode, @email, @phone, @isActive);
          SELECT CAST(1 AS INT) AS inserted;
        END
        ELSE
        BEGIN
          SELECT CAST(0 AS INT) AS inserted;
        END
      `);

    if (result.recordset[0] && result.recordset[0].inserted === 1) {
      inserted += 1;
    }
  }

  return { attempted: rows.length, inserted };
}

async function loadAgentIdMap(transaction) {
  const sql = require('mssql');
  const result = await new sql.Request(transaction)
    .input('prefix', sql.NVarChar(64), `${SEED_AGENT_PREFIX}%`)
    .query(`
      SELECT SeedKey, AgentId
      FROM dbo.Agents
      WHERE SeedKey LIKE @prefix;
    `);

  const map = new Map();
  for (const row of result.recordset) {
    map.set(row.SeedKey, row.AgentId);
  }
  return map;
}

async function seedListings(transaction, agentIdsBySeedKey) {
  const sql = require('mssql');
  const rows = buildListingRows(agentIdsBySeedKey);
  let inserted = 0;

  for (const row of rows) {
    const result = await new sql.Request(transaction)
      .input('mlsNumber', sql.VarChar(50), row.mlsNumber)
      .input('listingType', sql.VarChar(20), row.listingType)
      .input('propType', sql.VarChar(100), row.propType)
      .input('beds', sql.Int, row.beds)
      .input('baths', sql.Decimal(9, 2), row.baths)
      .input('sqFt', sql.Int, row.sqFt)
      .input('price', sql.Decimal(12, 2), row.price)
      .input('city', sql.NVarChar(100), row.city)
      .input('stateCode', sql.Char(2), row.stateCode)
      .input('addressLine', sql.NVarChar(200), row.addressLine)
      .input('description', sql.NVarChar(1000), row.description)
      .input('agentId', sql.Int, row.agentId)
      .input('listedAt', sql.Date, row.listedAt)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.Listings WHERE MlsNumber = @mlsNumber)
        BEGIN
          INSERT INTO dbo.Listings (
            MlsNumber, ListingType, PropType, Beds, Baths, SqFt, Price,
            City, StateCode, AddressLine, Description, AgentId, ListedAt
          )
          VALUES (
            @mlsNumber, @listingType, @propType, @beds, @baths, @sqFt, @price,
            @city, @stateCode, @addressLine, @description, @agentId, @listedAt
          );
          SELECT CAST(1 AS INT) AS inserted;
        END
        ELSE
        BEGIN
          SELECT CAST(0 AS INT) AS inserted;
        END
      `);

    if (result.recordset[0] && result.recordset[0].inserted === 1) {
      inserted += 1;
    }
  }

  return { attempted: rows.length, inserted };
}

async function verify(pool) {
  const counts = await pool.request().query(`
    SELECT
      (SELECT COUNT(1) FROM dbo.Agents WHERE SeedKey LIKE '${SEED_AGENT_PREFIX}%') AS seedAgents,
      (SELECT COUNT(1) FROM dbo.Listings WHERE MlsNumber LIKE '${SEED_MLS_PREFIX}%') AS seedListings,
      (SELECT COUNT(1) FROM dbo.Listings) AS totalListings,
      (SELECT COUNT(1) FROM dbo.Agents) AS totalAgents;
  `);

  const listingTypes = await pool.request().query(`
    SELECT ListingType, COUNT(1) AS cnt
    FROM dbo.Listings
    GROUP BY ListingType
    ORDER BY ListingType;
  `);

  const invalidTypes = await pool.request().query(`
    SELECT COUNT(1) AS badCount
    FROM dbo.Listings
    WHERE ListingType NOT IN ('sale', 'rental');
  `);

  const sampleSale = await pool
    .request()
    .input('listing_type', require('mssql').VarChar(50), 'sale')
    .execute('dbo.GetLoveableAPIListings');

  const sampleRentalCondo = await pool
    .request()
    .input('listing_type', require('mssql').VarChar(50), 'rental')
    .input('propTypes', require('mssql').VarChar(100), 'Condo')
    .execute('dbo.GetLoveableAPIListings');

  const emptyMls = await pool
    .request()
    .input('listing_type', require('mssql').VarChar(50), 'sale')
    .input('mls', require('mssql').VarChar(50), 'DOES-NOT-EXIST')
    .execute('dbo.GetLoveableAPIListings');

  const roster = await pool.request().execute('dbo.GetLoveableAPIAgentRoster');

  return {
    counts: counts.recordset[0],
    listingTypes: listingTypes.recordset,
    invalidListingTypes: invalidTypes.recordset[0].badCount,
    spSaleRows: (sampleSale.recordset || []).length,
    spRentalCondoRows: (sampleRentalCondo.recordset || []).length,
    spEmptyMlsRows: (emptyMls.recordset || []).length,
    spRosterRows: (roster.recordset || []).length,
  };
}

async function main() {
  const { env, assertSqlConfigured, getDatabaseModeLabel } = require('../src/config/env');
  const { getPool, closePool, isMockDatabase } = require('../src/config/database');
  const sql = require('mssql');

  console.log(`[seed] Database mode: ${getDatabaseModeLabel()}`);

  if (isMockDatabase()) {
    console.error('[seed] MOCK_DATABASE=true. Set MOCK_DATABASE=false to seed SQL Server.');
    process.exitCode = 1;
    return;
  }

  const missing = assertSqlConfigured();
  if (missing.length > 0) {
    console.error(`[seed] Missing SQL configuration: ${missing.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `[seed] Target ${env.sql.server}:${env.sql.port} / database=${env.sql.database} / user=${env.sql.user}`
  );

  let pool;
  try {
    pool = await getPool();

    console.log('[seed] Ensuring schema and stored procedures...');
    await ensureSchema(pool);

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      console.log('[seed] Seeding agents...');
      const agentStats = await seedAgents(transaction);
      const agentMap = await loadAgentIdMap(transaction);

      if (agentMap.size < TARGET_AGENTS) {
        throw new Error(`Expected ${TARGET_AGENTS} seed agents, found ${agentMap.size}`);
      }

      console.log('[seed] Seeding listings...');
      const listingStats = await seedListings(transaction, agentMap);

      await transaction.commit();

      console.log(
        `[seed] Agents: inserted ${agentStats.inserted} of ${agentStats.attempted} (idempotent)`
      );
      console.log(
        `[seed] Listings: inserted ${listingStats.inserted} of ${listingStats.attempted} (idempotent)`
      );
    } catch (error) {
      await transaction.rollback();
      throw error;
    }

    const report = await verify(pool);
    console.log('[seed] Verification:');
    console.log(`  seed agents=${report.counts.seedAgents}, total agents=${report.counts.totalAgents}`);
    console.log(
      `  seed listings=${report.counts.seedListings}, total listings=${report.counts.totalListings}`
    );
    console.log(
      `  listing_type distribution: ${report.listingTypes
        .map((r) => `${r.ListingType}=${r.cnt}`)
        .join(', ')}`
    );
    console.log(`  invalid listing_type rows=${report.invalidListingTypes}`);
    console.log(`  SP GetLoveableAPIListings(sale) rows=${report.spSaleRows}`);
    console.log(`  SP GetLoveableAPIListings(rental, Condo) rows=${report.spRentalCondoRows}`);
    console.log(`  SP GetLoveableAPIListings(sale, missing MLS) rows=${report.spEmptyMlsRows}`);
    console.log(`  SP GetLoveableAPIAgentRoster rows=${report.spRosterRows}`);

    if (report.invalidListingTypes > 0) {
      throw new Error('Found listing_type values outside sale/rental');
    }

    console.log('[seed] OK');
  } catch (error) {
    console.error(`[seed] FAIL: ${error.message}`);
    if (error.code) {
      console.error(`[seed] code=${error.code}`);
    }
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(`[seed] Unexpected error: ${error.message}`);
  process.exitCode = 1;
});
