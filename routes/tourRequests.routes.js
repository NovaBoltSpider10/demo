const express = require('express');
const { pool } = require('../config/db');
const handleDbError = require('../middleware/errorHandler');
const { toSqlDateTime, toNullableInt, toNullableFloat } = require('../utils/validators');
const { badRequest, notFound } = require('../utils/errors');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const status = (req.query.status || '').trim();

    let sql = `
      SELECT tr.*, fb.business_name AS matched_fleet_name,
             CONCAT(c.first_name, ' ', c.last_name) AS customer_name
      FROM TourRequest tr
      LEFT JOIN FleetBusiness fb ON tr.matched_fleet_business_id = fb.fleet_business_id
      LEFT JOIN Customer c ON tr.customer_user_id = c.customer_user_id
      WHERE 1=1
    `;
    const params = [];

    if (q) {
      sql += ' AND (tr.pickup_location LIKE ? OR tr.destination_location LIKE ? OR tr.vehicle_type LIKE ? OR tr.contact_phone LIKE ?)';
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    if (status) {
      sql += ' AND tr.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY tr.tour_request_id DESC';

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    handleDbError(res, err);
  }
});

router.post('/', async (req, res) => {
  try {
    const customer_user_id = toNullableInt(req.body.customer_user_id);
    const matched_fleet_business_id = toNullableInt(req.body.matched_fleet_business_id);
    const pickup_location = String(req.body.pickup_location || '').trim();
    const destination_location = String(req.body.destination_location || '').trim();
    const tour_duration_option = String(req.body.tour_duration_option || '').trim();
    const tour_start_date = toSqlDateTime(req.body.tour_start_date);
    const tour_end_date = toSqlDateTime(req.body.tour_end_date);
    const vehicle_type = req.body.vehicle_type ? String(req.body.vehicle_type).trim() : null;
    const bags_count = req.body.bags_count === undefined || req.body.bags_count === ''
      ? 1
      : toNullableInt(req.body.bags_count);
    const contact_phone = String(req.body.contact_phone || '').trim();
    const fare = toNullableFloat(req.body.fare);
    const status = req.body.status ? String(req.body.status).trim() : 'Pending';

    if (!customer_user_id || customer_user_id <= 0) throw badRequest('Valid Customer User ID is required.');
    if (matched_fleet_business_id !== null && (Number.isNaN(matched_fleet_business_id) || matched_fleet_business_id <= 0)) {
      throw badRequest('Matched Fleet Business ID must be a positive integer.');
    }
    if (!pickup_location || !destination_location || !tour_duration_option || !tour_start_date || !tour_end_date || !contact_phone) {
      throw badRequest('Pickup, destination, duration option, start date, end date, and contact phone are required.');
    }
    if (new Date(tour_end_date) < new Date(tour_start_date)) {
      throw badRequest('End date/time must be on or after start date/time.');
    }
    if (bags_count === null || Number.isNaN(bags_count) || bags_count < 0) {
      throw badRequest('Bags count must be 0 or greater.');
    }
    if (fare !== null && (Number.isNaN(fare) || fare < 0)) {
      throw badRequest('Fare must be 0 or greater.');
    }

    const [result] = await pool.query(
      `INSERT INTO TourRequest
       (customer_user_id, matched_fleet_business_id, pickup_location, destination_location,
        tour_duration_option, tour_start_date, tour_end_date, vehicle_type, bags_count,
        contact_phone, fare, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [customer_user_id, matched_fleet_business_id, pickup_location, destination_location,
       tour_duration_option, tour_start_date, tour_end_date, vehicle_type, bags_count,
       contact_phone, fare, status]
    );
    const [rows] = await pool.query('SELECT * FROM TourRequest WHERE tour_request_id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    handleDbError(res, err);
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw badRequest('Invalid tour request ID.');

    const [existingRows] = await pool.query('SELECT * FROM TourRequest WHERE tour_request_id = ?', [id]);
    if (!existingRows.length) throw notFound('Tour request not found.');
    const cur = existingRows[0];

    const customer_user_id = req.body.customer_user_id !== undefined
      ? toNullableInt(req.body.customer_user_id)
      : cur.customer_user_id;
    const matched_fleet_business_id = req.body.matched_fleet_business_id !== undefined
      ? toNullableInt(req.body.matched_fleet_business_id)
      : cur.matched_fleet_business_id;
    const pickup_location = req.body.pickup_location !== undefined
      ? String(req.body.pickup_location).trim()
      : cur.pickup_location;
    const destination_location = req.body.destination_location !== undefined
      ? String(req.body.destination_location).trim()
      : cur.destination_location;
    const tour_duration_option = req.body.tour_duration_option !== undefined
      ? String(req.body.tour_duration_option).trim()
      : cur.tour_duration_option;
    const tour_start_date = req.body.tour_start_date !== undefined
      ? toSqlDateTime(req.body.tour_start_date)
      : toSqlDateTime(cur.tour_start_date);
    const tour_end_date = req.body.tour_end_date !== undefined
      ? toSqlDateTime(req.body.tour_end_date)
      : toSqlDateTime(cur.tour_end_date);
    const vehicle_type = req.body.vehicle_type !== undefined
      ? (String(req.body.vehicle_type).trim() || null)
      : cur.vehicle_type;
    const bags_count = req.body.bags_count !== undefined
      ? toNullableInt(req.body.bags_count)
      : Number(cur.bags_count);
    const contact_phone = req.body.contact_phone !== undefined
      ? String(req.body.contact_phone).trim()
      : cur.contact_phone;
    const fare = req.body.fare !== undefined
      ? toNullableFloat(req.body.fare)
      : (cur.fare !== null ? Number(cur.fare) : null);
    const status = req.body.status !== undefined ? String(req.body.status).trim() : cur.status;

    if (!customer_user_id || customer_user_id <= 0) throw badRequest('Valid Customer User ID is required.');
    if (matched_fleet_business_id !== null && (Number.isNaN(matched_fleet_business_id) || matched_fleet_business_id <= 0)) {
      throw badRequest('Matched Fleet Business ID must be a positive integer.');
    }
    if (!pickup_location || !destination_location || !tour_duration_option || !tour_start_date || !tour_end_date || !contact_phone || !status) {
      throw badRequest('Required fields cannot be blank.');
    }
    if (new Date(tour_end_date) < new Date(tour_start_date)) {
      throw badRequest('End date/time must be on or after start date/time.');
    }
    if (bags_count === null || Number.isNaN(bags_count) || bags_count < 0) {
      throw badRequest('Bags count must be 0 or greater.');
    }
    if (fare !== null && (Number.isNaN(fare) || fare < 0)) {
      throw badRequest('Fare must be 0 or greater.');
    }

    await pool.query(
      `UPDATE TourRequest
       SET customer_user_id = ?, matched_fleet_business_id = ?, pickup_location = ?, destination_location = ?,
           tour_duration_option = ?, tour_start_date = ?, tour_end_date = ?, vehicle_type = ?,
           bags_count = ?, contact_phone = ?, fare = ?, status = ?
       WHERE tour_request_id = ?`,
      [customer_user_id, matched_fleet_business_id, pickup_location, destination_location,
       tour_duration_option, tour_start_date, tour_end_date, vehicle_type,
       bags_count, contact_phone, fare, status, id]
    );
    const [rows] = await pool.query('SELECT * FROM TourRequest WHERE tour_request_id = ?', [id]);
    res.json(rows[0]);
  } catch (err) {
    handleDbError(res, err);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw badRequest('Invalid tour request ID.');
    const [result] = await pool.query('DELETE FROM TourRequest WHERE tour_request_id = ?', [id]);
    if (result.affectedRows === 0) throw notFound('Tour request not found.');
    res.status(204).send();
  } catch (err) {
    handleDbError(res, err);
  }
});

module.exports = router;