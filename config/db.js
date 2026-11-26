const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME || 'tourmarket',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true
});

async function verifyDbConnection() {
  try {
    await pool.query('SELECT 1');
    console.log('[DB] MySQL connection pool verified.');
  } catch (err) {
    console.error('[DB] Initial MySQL connection failed:', err.message);
  }
}

module.exports = { pool, verifyDbConnection };