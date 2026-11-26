const express = require('express');
const { pool } = require('../config/db');
const handleDbError = require('../middleware/errorHandler');
const { toNullableInt, toNullableFloat } = require('../utils/validators');
const { badRequest, notFound } = require('../utils/errors');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const type = (req.query.type || '').trim();
    const minCapacity = req.query.min_capacity;

    let sql = `
      SELECT v.*, fb.business_name
      FROM Vehicle v
      LEFT JOIN FleetBusiness fb ON v.fleet_business_id = fb.fleet_business_id
      WHERE 1=1
    `;
    const params = [];

    if (q) {
      sql += ' AND (v.make LIKE ? OR v.model LIKE ? OR v.license_plate LIKE ? OR v.type LIKE ?)';
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    if (type) {
      sql += ' AND v.type LIKE ?';
      params.push(`%${type}%`);
    }
    if (minCapacity && !Number.isNaN(Number(minCapacity))) {
      sql += ' AND v.capacity >= ?';
      params.push(Number(minCapacity));
    }
    sql += ' ORDER BY v.vehicle_id DESC';

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    handleDbError(res, err);
  }
});

router.post('/', async (req, res) => {
  try {
    const fleet_business_id = toNullableInt(req.body.fleet_business_id);
    const make = String(req.body.make || '').trim();
    const model = String(req.body.model || '').trim();
    const model_year = toNullableInt(req.body.model_year);
    const license_plate = String(req.body.license_plate || '').trim();
    const color = req.body.color ? String(req.body.color).trim() : null;
    const capacity = toNullableInt(req.body.capacity);
    const type = String(req.body.type || '').trim();
    const hourly_rate = toNullableFloat(req.body.hourly_rate);
    const vehicle_class = req.body.vehicle_class ? String(req.body.vehicle_class).trim() : null;
    const fuel_type = req.body.fuel_type ? String(req.body.fuel_type).trim() : null;

    if (!fleet_business_id || fleet_business_id <= 0) throw badRequest('Valid Fleet Business ID is required.');
    if (!make || !model || !license_plate || !type) {
      throw badRequest('Make, model, license plate, and vehicle type are required.');
    }
    if (!model_year || model_year < 1901 || model_year > 2155) {
      throw badRequest('Model year must be a valid 4-digit year (1901–2155).');
    }
    if (!capacity || capacity <= 0) throw badRequest('Passenger capacity must be greater than 0.');
    if (hourly_rate === null || Number.isNaN(hourly_rate) || hourly_rate < 0) {
      throw badRequest('Hourly rate must be 0 or greater.');
    }

    const [result] = await pool.query(
      `INSERT INTO Vehicle
       (fleet_business_id, make, model, model_year, license_plate, color, capacity, type, hourly_rate, vehicle_class, fuel_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [fleet_business_id, make, model, model_year, license_plate, color, capacity, type, hourly_rate, vehicle_class, fuel_type]
    );
    const [rows] = await pool.query('SELECT * FROM Vehicle WHERE vehicle_id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    handleDbError(res, err);
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw badRequest('Invalid vehicle ID.');

    const [existingRows] = await pool.query('SELECT * FROM Vehicle WHERE vehicle_id = ?', [id]);
    if (!existingRows.length) throw notFound('Vehicle not found.');
    const cur = existingRows[0];

    const fleet_business_id = req.body.fleet_business_id !== undefined
      ? toNullableInt(req.body.fleet_business_id)
      : cur.fleet_business_id;
    const make = req.body.make !== undefined ? String(req.body.make).trim() : cur.make;
    const model = req.body.model !== undefined ? String(req.body.model).trim() : cur.model;
    const model_year = req.body.model_year !== undefined ? toNullableInt(req.body.model_year) : Number(cur.model_year);
    const license_plate = req.body.license_plate !== undefined ? String(req.body.license_plate).trim() : cur.license_plate;
    const color = req.body.color !== undefined ? (String(req.body.color).trim() || null) : cur.color;
    const capacity = req.body.capacity !== undefined ? toNullableInt(req.body.capacity) : Number(cur.capacity);
    const type = req.body.type !== undefined ? String(req.body.type).trim() : cur.type;
    const hourly_rate = req.body.hourly_rate !== undefined ? toNullableFloat(req.body.hourly_rate) : Number(cur.hourly_rate);
    const vehicle_class = req.body.vehicle_class !== undefined ? (String(req.body.vehicle_class).trim() || null) : cur.vehicle_class;
    const fuel_type = req.body.fuel_type !== undefined ? (String(req.body.fuel_type).trim() || null) : cur.fuel_type;

    if (!fleet_business_id || fleet_business_id <= 0) throw badRequest('Valid Fleet Business ID is required.');
    if (!make || !model || !license_plate || !type) {
      throw badRequest('Make, model, license plate, and vehicle type cannot be empty.');
    }
    if (!model_year || model_year < 1901 || model_year > 2155) {
      throw badRequest('Model year must be a valid 4-digit year (1901–2155).');
    }
    if (!capacity || capacity <= 0) throw badRequest('Passenger capacity must be greater than 0.');
    if (hourly_rate === null || Number.isNaN(hourly_rate) || hourly_rate < 0) {
      throw badRequest('Hourly rate must be 0 or greater.');
    }

    await pool.query(
      `UPDATE Vehicle
       SET fleet_business_id = ?, make = ?, model = ?, model_year = ?, license_plate = ?,
           color = ?, capacity = ?, type = ?, hourly_rate = ?, vehicle_class = ?, fuel_type = ?
       WHERE vehicle_id = ?`,
      [fleet_business_id, make, model, model_year, license_plate, color, capacity, type, hourly_rate, vehicle_class, fuel_type, id]
    );
    const [rows] = await pool.query('SELECT * FROM Vehicle WHERE vehicle_id = ?', [id]);
    res.json(rows[0]);
  } catch (err) {
    handleDbError(res, err);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw badRequest('Invalid vehicle ID.');
    const [result] = await pool.query('DELETE FROM Vehicle WHERE vehicle_id = ?', [id]);
    if (result.affectedRows === 0) throw notFound('Vehicle not found.');
    res.status(204).send();
  } catch (err) {
    handleDbError(res, err);
  }
});

module.exports = router;