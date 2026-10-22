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

// Allow the frontend origin(s) listed in CORS_ORIGIN (comma-separated).
const corsOrigins = env.corsOrigin
  .split(',')
  .map((part) => part.trim())
  .filter(Boolean);
app.use(cors({ origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins }));
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
