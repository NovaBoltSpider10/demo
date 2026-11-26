const express = require('express');
const { pool } = require('../config/db');
const handleDbError = require('../middleware/errorHandler');
const { toNullableInt, toNullableFloat } = require('../utils/validators');
const { badRequest, notFound } = require('../utils/errors');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const available = req.query.available;
    const fleetId = req.query.fleet_business_id;

    let sql = `
      SELECT d.*, fb.business_name
      FROM Driver d
      LEFT JOIN FleetBusiness fb ON d.fleet_business_id = fb.fleet_business_id
      WHERE 1=1
    `;
    const params = [];

    if (q) {
      sql += ' AND (d.first_name LIKE ? OR d.last_name LIKE ? OR d.email LIKE ? OR d.phone LIKE ?)';
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    if (available === '1' || available === '0') {
      sql += ' AND d.available = ?';
      params.push(Number(available));
    }
    if (fleetId && Number.isInteger(Number(fleetId))) {
      sql += ' AND d.fleet_business_id = ?';
      params.push(Number(fleetId));
    }
    sql += ' ORDER BY d.driver_id DESC';

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    handleDbError(res, err);
  }
});

router.post('/', async (req, res) => {
  try {
    const fleet_business_id = toNullableInt(req.body.fleet_business_id);
    const first_name = String(req.body.first_name || '').trim();
    const last_name = String(req.body.last_name || '').trim();
    const date_of_birth = String(req.body.date_of_birth || '').trim();
    const sex = req.body.sex ? String(req.body.sex).trim() : null;
    const address = req.body.address ? String(req.body.address).trim() : null;
    const pincode = req.body.pincode ? String(req.body.pincode).trim() : null;
    const email = String(req.body.email || '').trim();
    const phone = String(req.body.phone || '').trim();
    const experience_years = toNullableFloat(req.body.experience_years);
    const rating = toNullableFloat(req.body.rating);
    const available = req.body.available === undefined ? 1 : (Number(req.body.available) ? 1 : 0);

    if (!fleet_business_id || fleet_business_id <= 0) throw badRequest('Valid Fleet Business ID is required.');
    if (!first_name || !last_name || !date_of_birth || !email || !phone) {
      throw badRequest('First name, last name, date of birth, email, and phone are required.');
    }
    if (experience_years === null || Number.isNaN(experience_years) || experience_years < 0) {
      throw badRequest('Experience years must be 0 or greater.');
    }
    if (rating !== null && (Number.isNaN(rating) || rating < 0 || rating > 5)) {
      throw badRequest('Rating must be between 0.00 and 5.00.');
    }

    const [result] = await pool.query(
      `INSERT INTO Driver
       (fleet_business_id, first_name, last_name, date_of_birth, sex, address, pincode, email, phone, experience_years, rating, available)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [fleet_business_id, first_name, last_name, date_of_birth, sex, address, pincode, email, phone, experience_years, rating, available]
    );
    const [rows] = await pool.query('SELECT * FROM Driver WHERE driver_id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    handleDbError(res, err);
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw badRequest('Invalid driver ID.');

    const [existingRows] = await pool.query('SELECT * FROM Driver WHERE driver_id = ?', [id]);
    if (!existingRows.length) throw notFound('Driver not found.');
    const cur = existingRows[0];

    const fleet_business_id = req.body.fleet_business_id !== undefined
      ? toNullableInt(req.body.fleet_business_id)
      : cur.fleet_business_id;
    const first_name = req.body.first_name !== undefined ? String(req.body.first_name).trim() : cur.first_name;
    const last_name = req.body.last_name !== undefined ? String(req.body.last_name).trim() : cur.last_name;
    const date_of_birth = req.body.date_of_birth !== undefined ? String(req.body.date_of_birth).trim() : cur.date_of_birth;
    const sex = req.body.sex !== undefined ? (String(req.body.sex).trim() || null) : cur.sex;
    const address = req.body.address !== undefined ? (String(req.body.address).trim() || null) : cur.address;
    const pincode = req.body.pincode !== undefined ? (String(req.body.pincode).trim() || null) : cur.pincode;
    const email = req.body.email !== undefined ? String(req.body.email).trim() : cur.email;
    const phone = req.body.phone !== undefined ? String(req.body.phone).trim() : cur.phone;
    const experience_years = req.body.experience_years !== undefined
      ? toNullableFloat(req.body.experience_years)
      : Number(cur.experience_years);
    const rating = req.body.rating !== undefined
      ? toNullableFloat(req.body.rating)
      : (cur.rating !== null ? Number(cur.rating) : null);
    const available = req.body.available !== undefined ? (Number(req.body.available) ? 1 : 0) : (cur.available ? 1 : 0);

    if (!fleet_business_id || fleet_business_id <= 0) throw badRequest('Valid Fleet Business ID is required.');
    if (!first_name || !last_name || !date_of_birth || !email || !phone) {
      throw badRequest('First name, last name, date of birth, email, and phone cannot be empty.');
    }
    if (experience_years === null || Number.isNaN(experience_years) || experience_years < 0) {
      throw badRequest('Experience years must be 0 or greater.');
    }
    if (rating !== null && (Number.isNaN(rating) || rating < 0 || rating > 5)) {
      throw badRequest('Rating must be between 0.00 and 5.00.');
    }

    await pool.query(
      `UPDATE Driver
       SET fleet_business_id = ?, first_name = ?, last_name = ?, date_of_birth = ?, sex = ?,
           address = ?, pincode = ?, email = ?, phone = ?, experience_years = ?, rating = ?, available = ?
       WHERE driver_id = ?`,
      [fleet_business_id, first_name, last_name, date_of_birth, sex, address, pincode, email, phone, experience_years, rating, available, id]
    );
    const [rows] = await pool.query('SELECT * FROM Driver WHERE driver_id = ?', [id]);
    res.json(rows[0]);
  } catch (err) {
    handleDbError(res, err);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw badRequest('Invalid driver ID.');
    const [result] = await pool.query('DELETE FROM Driver WHERE driver_id = ?', [id]);
    if (result.affectedRows === 0) throw notFound('Driver not found.');
    res.status(204).send();
  } catch (err) {
    handleDbError(res, err);
  }
});

module.exports = router;