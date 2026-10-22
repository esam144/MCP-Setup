const express = require('express');
const procedureRoutes = require('./procedureRoutes');
const validationRoutes = require('./validationRoutes');
const executionRoutes = require('./executionRoutes');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'SQL procedure validation API',
    endpoints: [
      'GET /api/procedures',
      'GET /api/procedures/:procedure/parameters',
      'POST /api/procedures/refresh-cache',
      'POST /api/validate',
      'POST /api/interpret',
      'POST /api/execute',
    ],
  });
});

router.use(procedureRoutes);
router.use(validationRoutes);
router.use(executionRoutes);

module.exports = router;
