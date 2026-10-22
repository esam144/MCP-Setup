const { env } = require('../config/env');

function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Not found' },
  });
}

function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  let code = err.code;
  if (!code) {
    code = status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR';
  }

  if (env.nodeEnv === 'development') {
    console.error('[api]', code, err.message, err.cause || '');
  } else if (status >= 500) {
    console.error('[api]', code, err.message);
  }

  // MCP tool failures may already include a structured payload.
  if (err.payload && typeof err.payload === 'object') {
    res.status(status).json({
      success: false,
      ...err.payload,
      error: err.payload.error || { code, message: err.message },
    });
    return;
  }

  let message = err.message;
  if (status >= 500 && env.isProduction) {
    message = 'Internal server error';
  }

  res.status(status).json({
    success: false,
    error: {
      code,
      message,
    },
  });
}

// Protects POST /api/execute when API_AUTH_TOKEN is set.
function requireApiAuth(req, res, next) {
  if (!env.apiAuthToken) {
    if (env.isProduction) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'AUTH_REQUIRED',
          message: 'API_AUTH_TOKEN must be configured before public deployment.',
        },
      });
    }
    return next();
  }

  const header = req.headers.authorization || '';
  let token = '';
  if (header.startsWith('Bearer ')) {
    token = header.slice(7);
  }

  if (token !== env.apiAuthToken) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid or missing bearer token.' },
    });
  }

  return next();
}

module.exports = {
  notFoundHandler,
  errorHandler,
  requireApiAuth,
};
