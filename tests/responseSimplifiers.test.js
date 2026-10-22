const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  simplifyProceduresList,
  simplifyProcedureParameters,
  simplifyValidate,
  simplifyInterpret,
  simplifyExecute,
} = require('../src/utils/responseSimplifiers');

describe('responseSimplifiers', () => {
  it('simplifies procedures list to qualified name strings', () => {
    const simplified = simplifyProceduresList({
      success: true,
      procedures: [
        { schema: 'dbo', name: 'GetLoveableAPIListings', qualifiedName: 'dbo.GetLoveableAPIListings' },
        { schema: 'dbo', name: 'GetLoveableAPIAgentRoster', qualifiedName: 'dbo.GetLoveableAPIAgentRoster' },
      ],
    });

    assert.deepEqual(simplified, {
      success: true,
      procedures: ['dbo.GetLoveableAPIListings', 'dbo.GetLoveableAPIAgentRoster'],
    });
  });

  it('simplifies procedure parameters to name + type only', () => {
    const simplified = simplifyProcedureParameters({
      success: true,
      metadata: {
        qualifiedName: 'dbo.GetLoveableAPIListings',
        parameters: [
          { name: '@listing_type', sqlType: 'varchar', ordinal: 1, maxLength: 50 },
          { name: '@minBed', sqlType: 'int', ordinal: 2, precision: 10 },
          { name: '@RETURN_VALUE', sqlType: 'int', isOutput: true },
        ],
        mock: true,
        normalizedName: 'dbo.getloveableapilistings',
      },
    });

    assert.deepEqual(simplified, {
      success: true,
      procedure: 'dbo.GetLoveableAPIListings',
      parameters: [
        { name: 'listing_type', type: 'varchar' },
        { name: 'minBed', type: 'int' },
      ],
    });
  });

  it('simplifies successful validation and keeps normalized parameters', () => {
    const simplified = simplifyValidate({
      success: true,
      valid: true,
      procedure: 'dbo.GetLoveableAPIListings',
      errors: [],
      normalizedParameters: { listing_type: 'sale', minBed: 2, maxBed: 5 },
      semantic: null,
    });

    assert.deepEqual(simplified, {
      success: true,
      valid: true,
      procedure: 'dbo.GetLoveableAPIListings',
      errors: [],
      parameters: { listing_type: 'sale', minBed: 2, maxBed: 5 },
    });
  });

  it('simplifies failed validation without parameters field', () => {
    const simplified = simplifyValidate({
      success: false,
      valid: false,
      procedure: 'dbo.GetLoveableAPIListings',
      errors: [
        {
          parameter: 'listing_type',
          code: 'INVALID_VALUE',
          message: 'Parameter "listing_type" must be one of: sale, rental.',
        },
      ],
      normalizedParameters: null,
    });

    assert.equal(simplified.success, false);
    assert.equal(simplified.valid, false);
    assert.equal(simplified.parameters, undefined);
    assert.equal(simplified.errors[0].code, 'INVALID_VALUE');
  });

  it('simplifies interpret and drops nested validation metadata', () => {
    const simplified = simplifyInterpret({
      success: true,
      ambiguous: false,
      clarification: null,
      procedure: 'dbo.GetLoveableAPIListings',
      parameters: { listing_type: 'sale', minBed: 2, maxBed: 5 },
      rationale: 'Matched bedrooms and sale intent',
      validation: {
        valid: true,
        metadata: { parameters: [{ name: '@minBed', sqlType: 'int', ordinal: 3 }] },
      },
      errors: [],
    });

    assert.deepEqual(simplified, {
      success: true,
      procedure: 'dbo.GetLoveableAPIListings',
      parameters: { listing_type: 'sale', minBed: 2, maxBed: 5 },
      errors: [],
      rationale: 'Matched bedrooms and sale intent',
    });
    assert.equal(simplified.validation, undefined);
  });

  it('simplifies ambiguous interpret responses', () => {
    const simplified = simplifyInterpret({
      success: true,
      ambiguous: true,
      clarification: 'Please specify sale or rental.',
      procedure: null,
      parameters: {},
      errors: [],
    });

    assert.equal(simplified.success, true);
    assert.equal(simplified.ambiguous, true);
    assert.equal(simplified.clarification, 'Please specify sale or rental.');
  });

  it('simplifies mock execution without claiming real SQL ran', () => {
    const simplified = simplifyExecute({
      success: true,
      executed: true,
      mock: true,
      procedure: 'dbo.GetLoveableAPIListings',
      validation: { valid: true, errors: [] },
      result: {
        recordsets: [[]],
        rowsAffected: [0],
        truncated: false,
        maxRows: 500,
        mock: true,
        data: [],
        message: 'Mock execution completed. No SQL Server query was executed.',
        parametersEcho: { listing_type: 'sale' },
      },
      errors: [],
      message: 'Mock execution completed. No SQL Server query was executed.',
    });

    assert.deepEqual(simplified, {
      success: true,
      mock: true,
      procedure: 'dbo.GetLoveableAPIListings',
      data: [],
      message: 'Mock execution completed. No SQL Server query was executed.',
    });
  });

  it('simplifies failed execute responses', () => {
    const simplified = simplifyExecute({
      success: false,
      executed: false,
      procedure: 'dbo.GetLoveableAPIListings',
      errors: [{ parameter: 'listing_type', code: 'INVALID_VALUE', message: 'bad' }],
      result: null,
    });

    assert.deepEqual(simplified, {
      success: false,
      procedure: 'dbo.GetLoveableAPIListings',
      errors: [{ parameter: 'listing_type', code: 'INVALID_VALUE', message: 'bad' }],
    });
  });
});
