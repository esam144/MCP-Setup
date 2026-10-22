// Express application setup (middleware + routes).
// The HTTP server itself is started from index.js.

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const routes = require('./routes');
const { env } = require('./config/env');
const { apiRateLimiter } = require('./middleware/rateLimiter');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();

// Allow the frontend origin(s) listed in CORS_ORIGIN.
const corsOrigins = [];
for (const part of env.corsOrigin.split(',')) {
  const trimmed = part.trim();
  if (trimmed) {
    corsOrigins.push(trimmed);
  }
}

let corsOriginOption = corsOrigins;
if (corsOrigins.length === 1) {
  corsOriginOption = corsOrigins[0];
}

app.use(cors({ origin: corsOriginOption }));
app.use(morgan(env.isProduction ? 'combined' : 'dev'));
app.use(express.json({ limit: env.requestBodyLimit }));
app.use(apiRateLimiter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'express-api' });
});

app.use('/api', routes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
