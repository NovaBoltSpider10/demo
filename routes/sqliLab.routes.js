const express = require('express');
const { pool } = require('../config/db');
const handleDbError = require('../middleware/errorHandler');

const router = express.Router();

// Part (a): Intentionally vulnerable string-concatenated SELECT
router.post('/vulnerable', async (req, res) => {
  const email = req.body.email ?? '';
  const phone = req.body.phone ?? '';

  // Intentionally unsafe string concatenation for demonstration
  const executedSql =
    `SELECT customer_user_id, first_name, last_name, email, phone ` +
    `FROM Customer WHERE email = '${email}' AND phone = '${phone}'`;

  console.log('[SQLi Lab - Vulnerable SQL]', executedSql);

  try {
    const [rows] = await pool.query(executedSql);
    res.json({ executedSql, rows });
  } catch (err) {
    console.warn('[SQLi Lab - Vulnerable Error]', err.sqlMessage || err.message);
    res.status(400).json({
      error: err.sqlMessage || err.message || 'SQL syntax error in vulnerable query.',
      executedSql
    });
  }
});

// Part (b): Safe prepared statement using bound parameters (?)
router.post('/prepared', async (req, res) => {
  const email = String(req.body.email ?? '').trim();
  const phone = String(req.body.phone ?? '').trim();

  const preparedSql =
    'SELECT customer_user_id, first_name, last_name, email, phone FROM Customer WHERE email = ? AND phone = ?';
  const boundParams = [email, phone];

  console.log('[SQLi Lab - Prepared SQL]', preparedSql, 'params=', boundParams);

  try {
    const [rows] = await pool.execute(preparedSql, boundParams);
    res.json({ preparedSql, boundParams, rows });
  } catch (err) {
    handleDbError(res, err);
  }
});

module.exports = router;