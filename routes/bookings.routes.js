const express = require('express');
const { pool } = require('../config/db');
const handleDbError = require('../middleware/errorHandler');
const { toSqlDateTime, toNullableInt, toNullableFloat } = require('../utils/validators');
const { badRequest, notFound } = require('../utils/errors');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const status = (req.query.status || '').trim();
    const q = (req.query.q || '').trim();

    let sql = `
      SELECT b.*,
             CONCAT(d.first_name, ' ', d.last_name) AS driver_name,
             CONCAT(v.make, ' ', v.model, ' (', v.license_plate, ')') AS vehicle_label,
             tr.matched_fleet_business_id
      FROM Booking b
      LEFT JOIN Driver d ON b.driver_id = d.driver_id
      LEFT JOIN Vehicle v ON b.vehicle_id = v.vehicle_id
      LEFT JOIN TourRequest tr ON b.tour_request_id = tr.tour_request_id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      sql += ' AND b.status = ?';
      params.push(status);
    }
    if (q) {
      sql += ' AND (CAST(b.booking_id AS CHAR) LIKE ? OR CAST(b.tour_request_id AS CHAR) LIKE ? OR d.first_name LIKE ? OR d.last_name LIKE ? OR v.license_plate LIKE ?)';
      const like = `%${q}%`;
      params.push(like, like, like, like, like);
    }
    sql += ' ORDER BY b.booking_id DESC';

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    handleDbError(res, err);
  }
});

router.post('/', async (req, res) => {
  try {
    const tour_request_id = toNullableInt(req.body.tour_request_id);
    const driver_id = toNullableInt(req.body.driver_id);
    const vehicle_id = toNullableInt(req.body.vehicle_id);
    const start_time = toSqlDateTime(req.body.start_time);
    const end_time = toSqlDateTime(req.body.end_time);
    const distance = toNullableFloat(req.body.distance);
    const fare = toNullableFloat(req.body.fare);
    const status = req.body.status ? String(req.body.status).trim() : 'Scheduled';

    if (!tour_request_id || tour_request_id <= 0) throw badRequest('Valid Tour Request ID is required.');
    if (!driver_id || driver_id <= 0) throw badRequest('Valid Driver ID is required.');
    if (!vehicle_id || vehicle_id <= 0) throw badRequest('Valid Vehicle ID is required.');
    if (start_time && end_time && new Date(end_time) < new Date(start_time)) {
      throw badRequest('End time must be on or after start time.');
    }
    if (distance !== null && (Number.isNaN(distance) || distance < 0)) {
      throw badRequest('Distance must be 0 or greater.');
    }
    if (fare !== null && (Number.isNaN(fare) || fare < 0)) {
      throw badRequest('Fare must be 0 or greater.');
    }

    const [result] = await pool.query(
      `INSERT INTO Booking (tour_request_id, driver_id, vehicle_id, start_time, end_time, distance, fare, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [tour_request_id, driver_id, vehicle_id, start_time, end_time, distance, fare, status]
    );
    await pool.query(
      `UPDATE TourRequest
       SET status = 'Booked'
       WHERE tour_request_id = ? AND status <> 'Booked'`,
      [tour_request_id]
    );
    console.log(`[Dispatch] Created Booking #${result.insertId} for TourRequest #${tour_request_id} (Driver #${driver_id}, Vehicle #${vehicle_id})`);
    const [rows] = await pool.query('SELECT * FROM Booking WHERE booking_id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    handleDbError(res, err);
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw badRequest('Invalid booking ID.');

    const [existingRows] = await pool.query('SELECT * FROM Booking WHERE booking_id = ?', [id]);
    if (!existingRows.length) throw notFound('Booking not found.');
    const cur = existingRows[0];

    const tour_request_id = req.body.tour_request_id !== undefined
      ? toNullableInt(req.body.tour_request_id)
      : cur.tour_request_id;
    const driver_id = req.body.driver_id !== undefined ? toNullableInt(req.body.driver_id) : cur.driver_id;
    const vehicle_id = req.body.vehicle_id !== undefined ? toNullableInt(req.body.vehicle_id) : cur.vehicle_id;
    const start_time = req.body.start_time !== undefined ? toSqlDateTime(req.body.start_time) : toSqlDateTime(cur.start_time);
    const end_time = req.body.end_time !== undefined ? toSqlDateTime(req.body.end_time) : toSqlDateTime(cur.end_time);
    const distance = req.body.distance !== undefined
      ? toNullableFloat(req.body.distance)
      : (cur.distance !== null ? Number(cur.distance) : null);
    const fare = req.body.fare !== undefined
      ? toNullableFloat(req.body.fare)
      : (cur.fare !== null ? Number(cur.fare) : null);
    const status = req.body.status !== undefined ? String(req.body.status).trim() : cur.status;

    if (!tour_request_id || tour_request_id <= 0) throw badRequest('Valid Tour Request ID is required.');
    if (!driver_id || driver_id <= 0) throw badRequest('Valid Driver ID is required.');
    if (!vehicle_id || vehicle_id <= 0) throw badRequest('Valid Vehicle ID is required.');
    if (!status) throw badRequest('Status is required.');
    if (start_time && end_time && new Date(end_time) < new Date(start_time)) {
      throw badRequest('End time must be on or after start time.');
    }
    if (distance !== null && (Number.isNaN(distance) || distance < 0)) {
      throw badRequest('Distance must be 0 or greater.');
    }
    if (fare !== null && (Number.isNaN(fare) || fare < 0)) {
      throw badRequest('Fare must be 0 or greater.');
    }

    const [[reqRow]] = await pool.query(
      'SELECT matched_fleet_business_id FROM TourRequest WHERE tour_request_id = ?',
      [tour_request_id]
    );
    if (!reqRow || !reqRow.matched_fleet_business_id) {
      throw badRequest('Tour request must have a matched fleet business before assigning a booking.');
    }
    const [[drvRow]] = await pool.query('SELECT fleet_business_id FROM Driver WHERE driver_id = ?', [driver_id]);
    const [[vehRow]] = await pool.query('SELECT fleet_business_id FROM Vehicle WHERE vehicle_id = ?', [vehicle_id]);
    if (drvRow?.fleet_business_id !== reqRow.matched_fleet_business_id || vehRow?.fleet_business_id !== reqRow.matched_fleet_business_id) {
      throw badRequest('Assigned driver and vehicle must belong to the fleet business matched to the tour request.');
    }

    await pool.query(
      `UPDATE Booking
       SET tour_request_id = ?, driver_id = ?, vehicle_id = ?, start_time = ?, end_time = ?, distance = ?, fare = ?, status = ?
       WHERE booking_id = ?`,
      [tour_request_id, driver_id, vehicle_id, start_time, end_time, distance, fare, status, id]
    );
    const [rows] = await pool.query('SELECT * FROM Booking WHERE booking_id = ?', [id]);
    res.json(rows[0]);
  } catch (err) {
    handleDbError(res, err);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw badRequest('Invalid booking ID.');
    const [result] = await pool.query('DELETE FROM Booking WHERE booking_id = ?', [id]);
    if (result.affectedRows === 0) throw notFound('Booking not found.');
    res.status(204).send();
  } catch (err) {
    handleDbError(res, err);
  }
});

module.exports = router;