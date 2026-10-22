// Optional business rules from BUSINESS_RULES_JSON in .env.
// Example:
// {
//   "dbo.GetLoveableAPIListings": {
//     "required": ["listing_type"],
//     "enums": {
//       "listing_type": ["sale", "rental"],
//       "propTypes": ["Condo", "Townhouse", "Single Family", "Multi-Family", "Loft"]
//     },
//     "multiValueParams": ["propTypes"],
//     "ranges": { "minBed": { "min": 0, "max": 20 } },
//     "pairs": [{ "min": "minBed", "max": "maxBed" }, { "min": "minSqFt", "max": "maxSqFt" }]
//   }
// }

const { env, normalizeProcedureName } = require('./env');

function loadBusinessRules() {
  if (!env.businessRulesJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(env.businessRulesJson);
    const normalized = {};

    for (const key of Object.keys(parsed)) {
      normalized[normalizeProcedureName(key)] = parsed[key] || {};
    }

    return normalized;
  } catch (cause) {
    const error = new Error('BUSINESS_RULES_JSON is invalid JSON');
    error.code = 'BUSINESS_RULES_INVALID';
    error.status = 500;
    error.cause = cause;
    throw error;
  }
}

let cachedRules = null;

function getBusinessRules(procedureName) {
  if (!cachedRules) {
    cachedRules = loadBusinessRules();
  }
  return cachedRules[normalizeProcedureName(procedureName)] || {};
}

function resetBusinessRulesCache() {
  cachedRules = null;
}

module.exports = {
  getBusinessRules,
  resetBusinessRulesCache,
  loadBusinessRules,
};
