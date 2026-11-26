const express = require('express');
const { pool } = require('../config/db');
const handleDbError = require('../middleware/errorHandler');
const { badRequest, notFound } = require('../utils/errors');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    let sql = 'SELECT customer_user_id, first_name, last_name, email, phone FROM Customer';
    const params = [];
    if (q) {
      sql += ' WHERE first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR phone LIKE ?';
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    sql += ' ORDER BY customer_user_id DESC';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    handleDbError(res, err);
  }
});

router.post('/', async (req, res) => {
  try {
    const first_name = String(req.body.first_name || '').trim();
    const last_name = String(req.body.last_name || '').trim();
    const email = String(req.body.email || '').trim();
    const phone = String(req.body.phone || '').trim();

    if (!first_name || !last_name || !email || !phone) {
      throw badRequest('First name, last name, email, and phone are required.');
    }

    const [result] = await pool.query(
      'INSERT INTO Customer (first_name, last_name, email, phone) VALUES (?, ?, ?, ?)',
      [first_name, last_name, email, phone]
    );
    const [rows] = await pool.query('SELECT * FROM Customer WHERE customer_user_id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    handleDbError(res, err);
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw badRequest('Invalid customer ID.');

    const [existingRows] = await pool.query('SELECT * FROM Customer WHERE customer_user_id = ?', [id]);
    if (!existingRows.length) throw notFound('Customer not found.');
    const cur = existingRows[0];

    const first_name = req.body.first_name !== undefined ? String(req.body.first_name).trim() : cur.first_name;
    const last_name = req.body.last_name !== undefined ? String(req.body.last_name).trim() : cur.last_name;
    const email = req.body.email !== undefined ? String(req.body.email).trim() : cur.email;
    const phone = req.body.phone !== undefined ? String(req.body.phone).trim() : cur.phone;

    if (!first_name || !last_name || !email || !phone) {
      throw badRequest('First name, last name, email, and phone cannot be empty.');
    }

    await pool.query(
      'UPDATE Customer SET first_name = ?, last_name = ?, email = ?, phone = ? WHERE customer_user_id = ?',
      [first_name, last_name, email, phone, id]
    );
    const [rows] = await pool.query('SELECT * FROM Customer WHERE customer_user_id = ?', [id]);
    res.json(rows[0]);
  } catch (err) {
    handleDbError(res, err);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw badRequest('Invalid customer ID.');
    const [result] = await pool.query('DELETE FROM Customer WHERE customer_user_id = ?', [id]);
    if (result.affectedRows === 0) throw notFound('Customer not found.');
    res.status(204).send();
  } catch (err) {
    handleDbError(res, err);
  }
});

module.exports = router;