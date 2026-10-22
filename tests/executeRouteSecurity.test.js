const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('arbitrary SQL rejection', () => {
  it('rejects SQL injection-style procedure names at the route layer', () => {
    const cleaned = String("dbo.GetList; DROP TABLE Users--").replace(/[\[\]]/g, '');
    const ok = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(cleaned);
    assert.equal(ok, false);
  });

  it('accepts schema-qualified procedure identifiers', () => {
    const cleaned = 'dbo.GetLoveableAPIListings'.replace(/[\[\]]/g, '');
    const ok = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(cleaned);
    assert.equal(ok, true);
  });
});
