# MCP-Based SQL Server Stored Procedure Parameter Validator

Express API that validates and executes **allowlisted** Microsoft SQL Server stored procedures. The API talks to a dedicated **Model Context Protocol (MCP)** server over Streamable HTTP. The MCP server owns SQL metadata discovery, deterministic validation, optional Gemini assistance, and approved execution.

```
React Frontend  --HTTP JSON-->  Express API  --MCP client-->  MCP Server
                                                              |          |
                                                           Gemini     SQL Server
                                                              (or mock DB in development)
```

## Prerequisites

- Node.js 18+ (tested on Node 24)
- Either:
  - `MOCK_DATABASE=true` for local testing **without** SQL Server, or
  - Microsoft SQL Server credentials for real metadata/execution
- Google Gemini API key (optional; required only to test `/api/interpret` and semantic review)

## Installation

```bash
cd /home/esam/Desktop/Service
npm install
cp .env.example .env
# Edit .env — start with MOCK_DATABASE=true if you do not have SQL Server yet
```

## Environment configuration

See `.env.example`. Important variables:

| Variable | Purpose |
| --- | --- |
| `MOCK_DATABASE` | `true` = use in-memory fake SQL metadata/execution (dev only) |
| `SQL_*` | Real SQL Server connection (required when mock mode is off) |
| `ALLOWED_PROCEDURES` | Comma-separated schema-qualified procedures the app may use |
| `BUSINESS_RULES_JSON` | Optional required params, ranges, and min/max pairs |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Gemini for NL interpret + semantic review (default model: `gemini-2.5-flash`) |
| `GEMINI_TIMEOUT_MS` | SDK HTTP timeout for Gemini calls (default `90000`); app race is 5s longer |
| `GEMINI_MAX_RETRIES` | Extra attempts for transient 429/503/504 only (default `1`) |
| `MCP_SERVER_URL` / `MCP_SERVER_PORT` | MCP Streamable HTTP endpoint |
| `MCP_TOOL_TIMEOUT_MS` | Optional MCP `callTool` timeout (default derived from Gemini timeout × retries; SDK default is only 60s) |
| `MCP_AUTH_TOKEN` | Shared bearer token between API and MCP server |
| `API_AUTH_TOKEN` | Bearer token required for `POST /api/execute` (required in production) |
| `CORS_ORIGIN` | Allowed frontend origin(s), comma-separated |

**Never commit `.env`.** Placeholders only belong in `.env.example`.

### Mock database mode (no SQL Server required)

```env
MOCK_DATABASE=true
NODE_ENV=development
ALLOWED_PROCEDURES=dbo.GetLoveableAPIListings,dbo.GetLoveableAPIAgentRoster
```

When enabled:

- Startup logs show `Database mode: MOCK (...)`.
- No SQL Server credentials are required.
- No real SQL connections or queries are made.
- Metadata comes from `src/mocks/mockDatabase.js` (easy to edit).
- `/api/execute` returns a clearly labelled mock result after validation.
- If `MOCK_DATABASE=true` and `NODE_ENV=production`, the process **refuses to start**.
- A failed real SQL connection **never** silently flips the app into mock mode.

Edit mock schemas in `src/mocks/mockDatabase.js`. The `GetLoveableAPIAgentRoster` schema there is a **documented mock placeholder**, not claimed real SQL Server metadata.

### Switching to real SQL Server later

1. Set `MOCK_DATABASE=false` (or remove the variable).
2. Fill `SQL_SERVER`, `SQL_DATABASE`, `SQL_USER`, `SQL_PASSWORD` (local Ubuntu often uses `SQL_ENCRYPT=false` and `SQL_TRUST_SERVER_CERTIFICATE=true`).
3. Verify with `npm run test:db` (expects `DB_NAME()` = your configured database, e.g. `MCPDatabase`).
4. Bootstrap local tables/procedures and fictional seed rows: `npm run seed` (idempotent; uses `SEED-*` MLS/agent keys; does not delete existing data).
3. Keep `ALLOWED_PROCEDURES` aligned with procedures that exist on the server.
4. Restart MCP + Express. Startup should log `Database mode: REAL SQL Server`.

### Allowlist

If `ALLOWED_PROCEDURES` is empty, procedure tools return a configuration error. Unlisted procedures are never discoverable or executable.

```env
ALLOWED_PROCEDURES=dbo.GetLoveableAPIListings,dbo.GetLoveableAPIAgentRoster
```

### Business rules (optional)

```env
BUSINESS_RULES_JSON={"dbo.GetLoveableAPIListings":{"required":["listing_type"],"enums":{"listing_type":["sale","rental"]},"pairs":[{"min":"minBed","max":"maxBed"},{"min":"minSqFt","max":"maxSqFt"}],"ranges":{"minBed":{"min":0,"max":20},"maxBed":{"min":0,"max":20},"minSqFt":{"min":0},"maxSqFt":{"min":0}}}}
```

`listing_type` accepts only exact values `sale` or `rental` (`INVALID_VALUE` otherwise; no silent rewriting of `sales`/`rent`). Optional filters include `mls`, `propTypes`, `minSqFt`, and `maxSqFt` (`minSqFt` must not exceed `maxSqFt` when both are set).

## Start the services

Use two terminals (works the same in mock or real mode).

**1. MCP server**

```bash
npm run mcp
# or: npm run dev:mcp
```

**2. Express API**

```bash
npm run dev
# or: npm start
```

- API: `http://localhost:3000`
- MCP: `http://127.0.0.1:3001/mcp`

The Express process is an MCP **client**. Routes call MCP tools; they do not bypass MCP with direct service calls.

## Postman collection

Import [`postman/Service-API.postman_collection.json`](postman/Service-API.postman_collection.json) into Postman (**Import → File**). Set collection variables `baseUrl` (`http://localhost:3000`) and optional `apiAuthToken` if `API_AUTH_TOKEN` is set in `.env`.

## How to test each API endpoint

With both processes running and `MOCK_DATABASE=true`:

```bash
# Health
curl -s http://localhost:3000/health

# List allowlisted procedures (via MCP)
curl -s http://localhost:3000/api/procedures
# -> { "success": true, "procedures": ["dbo.GetLoveableAPIListings", ...] }

# Parameter names + types only
curl -s "http://localhost:3000/api/procedures/dbo.GetLoveableAPIListings/parameters"
# -> { "success": true, "procedure": "...", "parameters": [{ "name": "listing_type", "type": "varchar" }, ...] }

# Valid validation
curl -s -X POST http://localhost:3000/api/validate \
  -H 'Content-Type: application/json' \
  -d '{"procedure":"dbo.GetLoveableAPIListings","parameters":{"listing_type":"sale","minBed":2,"maxBed":5,"minBath":1.5,"maxBath":3}}'

# Invalid integer (expect valid:false)
curl -s -X POST http://localhost:3000/api/validate \
  -H 'Content-Type: application/json' \
  -d '{"procedure":"dbo.GetLoveableAPIListings","parameters":{"listing_type":"sale","minBed":"hello","maxBed":5}}'

# Mock execution (labelled; no SQL)
curl -s -X POST http://localhost:3000/api/execute \
  -H 'Content-Type: application/json' \
  -d '{"procedure":"dbo.GetLoveableAPIListings","parameters":{"listing_type":"sale","minBed":2,"maxBed":5}}'
# -> { "success": true, "mock": true, "procedure": "...", "data": [], "message": "Mock execution completed..." }
```

HTTP responses are simplified for the frontend. Internal MCP tools still carry full metadata for validation/execution.

### Test Gemini with a real API key

1. Set in `.env`:
   ```env
   GEMINI_API_KEY=your_key_here
   GEMINI_MODEL=gemini-2.5-flash
   GEMINI_TIMEOUT_MS=90000
   ```
2. Restart MCP + Express (`npm run mcp`, `npm run dev`).
3. Run:
   ```bash
   curl -s -X POST http://localhost:3000/api/interpret \
     -H 'Content-Type: application/json' \
     -d '{"request":"Find properties for sale with two to five bedrooms."}'
   ```

**Note:** Slow models or cold starts can exceed 30s; keep `GEMINI_TIMEOUT_MS` at least `90000` for `gemini-3.8-flash`.

Gemini proposals are always checked against the allowlist and deterministic validation. Gemini cannot authorize SQL execution.

If no key is set, the API still starts in mock database mode; interpret/semantic features return honest unavailable errors. Automated suite includes **mocked** Gemini tests; it does **not** require a live Gemini call.

## Deterministic vs Gemini-assisted validation

| Kind | Role |
| --- | --- |
| **Deterministic** | Allowlist, SQL/mock catalog types, lengths, precision/scale, business rules. **Authoritative for execution.** |
| **Gemini semantic** | Optional warnings. **Never authorizes SQL.** |

## MCP tools

| Tool | Purpose |
| --- | --- |
| `list_stored_procedures` | Approved procedures only |
| `get_procedure_parameters` | Metadata from SQL `sys.*` or mock catalog |
| `validate_parameters` | Deterministic (+ optional semantic) |
| `interpret_request` | Gemini NL → structured proposal |
| `execute_stored_procedure` | Validate then execute (or mock execute) |
| `refresh_metadata_cache` | Clear metadata cache |

## Security limitations

- This is **not** automatically production-secure.
- Never enable `MOCK_DATABASE` in production (startup fails if you try).
- Protect `POST /api/execute` with `API_AUTH_TOKEN` before public deployment.
- Keep the MCP server on localhost / private network; set `MCP_AUTH_TOKEN`.
- Use least-privilege SQL credentials when using the real database.

## Tests

```bash
npm test
```

| Kind | What it covers |
| --- | --- |
| Unit / mock DB tests | Validation, allowlist, mock metadata, mock execute, no real SQL connect |
| Mocked Gemini unit tests | Timeout / rate-limit / auth / unavailable / success / retry (no live API) |
| MCP integration tests | Real MCP client ↔ MCP server over Streamable HTTP using mock DB |
| Live SQL Server | **Not** run in CI; requires credentials + `MOCK_DATABASE=false` |
| Live Gemini | **Not** asserted in CI; optional manual curl with `GEMINI_API_KEY` |

## Project layout

```
src/
  index.js
  mcpServer.js
  mocks/mockDatabase.js   # editable fake SQL metadata + mock execute
  config/
  services/
  mcp/
  routes/
  middleware/
tests/
```

## Startup checklist (mock mode)

1. `MOCK_DATABASE=true`, `ALLOWED_PROCEDURES=...`, optional `GEMINI_API_KEY`
2. `npm run mcp`
3. `npm run dev`
4. Confirm logs show `Database mode: MOCK`
5. Exercise the curl commands above
