require('dotenv').config();
const path = require('path');
const express = require('express');
const mysql = require('mysql2/promise');

const app = express();
const PORT = Number(process.env.PORT || 3000);

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

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Request + status + latency logger for demo visibility
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
  });
  next();
});

function toSqlDateTime(val) {
  if (val === undefined || val === null || String(val).trim() === '') return null;
  const s = String(val).trim().replace('T', ' ');
  return s.length === 16 ? `${s}:00` : s;
}

function toNullableInt(val) {
  if (val === undefined || val === null || String(val).trim() === '') return null;
  const n = Number(val);
  return Number.isInteger(n) ? n : NaN;
}

function toNullableFloat(val) {
  if (val === undefined || val === null || String(val).trim() === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : NaN;
}

function handleDbError(res, err) {
  if (err && err.statusCode) {
    console.warn(`[Client ${err.statusCode}] ${err.message}`);
    return res.status(err.statusCode).json({ error: err.message });
  }
  const code = err?.code;
  const sqlState = err?.sqlState;
  console.warn(`[DB Error] code=${code || 'N/A'} sqlState=${sqlState || 'N/A'} msg=${err?.sqlMessage || err?.message}`);

  if (sqlState === '45000') {
    return res.status(400).json({ error: err.sqlMessage || err.message });
  }
  if (code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'Duplicate record: a unique field (such as email or license plate) already exists.' });
  }
  if (code === 'ER_NO_REFERENCED_ROW_2') {
    return res.status(400).json({ error: 'Referenced ID does not exist (check Customer, Fleet Business, Tour Request, Driver, or Vehicle ID).' });
  }
  if (code === 'ER_ROW_IS_REFERENCED_2') {
    return res.status(409).json({ error: 'Cannot delete record because other records reference it (restricted by foreign key).' });
  }
  if (code === 'WARN_DATA_TRUNCATED' || code === 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD' || code === 'ER_CHECK_CONSTRAINT_VIOLATED') {
    return res.status(400).json({ error: err.sqlMessage || 'Invalid field value or constraint violation.' });
  }

  console.error('[Unexpected DB Error]', err);
  return res.status(500).json({ error: 'Internal database error.' });
}

function badRequest(msg) {
  const err = new Error(msg);
  err.statusCode = 400;
  return err;
}

function notFound(msg = 'Record not found.') {
  const err = new Error(msg);
  err.statusCode = 404;
  return err;
}

// ==========================================
// REPORT / SUMMARY ENDPOINT
// ==========================================
app.get('/api/reports/overview', async (req, res) => {
  try {
    const [[counts]] = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM Customer) AS customers,
        (SELECT COUNT(*) FROM FleetBusiness) AS fleets,
        (SELECT COUNT(*) FROM Driver) AS drivers,
        (SELECT COUNT(*) FROM Vehicle) AS vehicles,
        (SELECT COUNT(*) FROM TourRequest) AS tour_requests,
        (SELECT COUNT(*) FROM Booking) AS bookings,
        (SELECT COALESCE(SUM(fare), 0) FROM Booking WHERE status <> 'Cancelled') AS total_booking_revenue
    `);

    const [fleetSummary] = await pool.query(`
      SELECT
        fb.fleet_business_id,
        fb.business_name,
        COUNT(DISTINCT d.driver_id) AS driver_count,
        COUNT(DISTINCT v.vehicle_id) AS vehicle_count,
        COUNT(DISTINCT tr.tour_request_id) AS matched_requests,
        COUNT(DISTINCT b.booking_id) AS booking_count
      FROM FleetBusiness fb
      LEFT JOIN Driver d ON d.fleet_business_id = fb.fleet_business_id
      LEFT JOIN Vehicle v ON v.fleet_business_id = fb.fleet_business_id
      LEFT JOIN TourRequest tr ON tr.matched_fleet_business_id = fb.fleet_business_id
      LEFT JOIN Booking b ON b.vehicle_id = v.vehicle_id
      GROUP BY fb.fleet_business_id, fb.business_name
      ORDER BY fb.fleet_business_id ASC
    `);

    res.json({ counts, fleetSummary });
  } catch (err) {
    handleDbError(res, err);
  }
});

// ==========================================
// 1. CUSTOMER CRUD
// ==========================================
app.get('/api/customers', async (req, res) => {
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

app.post('/api/customers', async (req, res) => {
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

app.put('/api/customers/:id', async (req, res) => {
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

app.delete('/api/customers/:id', async (req, res) => {
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

// ==========================================
// 2. FLEET BUSINESS CRUD
// ==========================================
app.get('/api/fleets', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    let sql = `
      SELECT fleet_business_id, business_name, contact_person, business_phone, business_email, operating_hours, address
      FROM FleetBusiness
    `;
    const params = [];
    if (q) {
      sql += ' WHERE business_name LIKE ? OR contact_person LIKE ? OR business_email LIKE ? OR address LIKE ?';
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    sql += ' ORDER BY fleet_business_id ASC';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    handleDbError(res, err);
  }
});

app.post('/api/fleets', async (req, res) => {
  try {
    const business_name = String(req.body.business_name || '').trim();
    const contact_person = String(req.body.contact_person || '').trim();
    const business_phone = String(req.body.business_phone || '').trim();
    const business_email = String(req.body.business_email || '').trim();
    const operating_hours = req.body.operating_hours ? String(req.body.operating_hours).trim() : null;
    const address = String(req.body.address || '').trim();

    if (!business_name || !contact_person || !business_phone || !business_email || !address) {
      throw badRequest('Business name, contact person, phone, email, and address are required.');
    }

    const [result] = await pool.query(
      `INSERT INTO FleetBusiness (business_name, contact_person, business_phone, business_email, operating_hours, address)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [business_name, contact_person, business_phone, business_email, operating_hours, address]
    );
    const [rows] = await pool.query('SELECT * FROM FleetBusiness WHERE fleet_business_id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    handleDbError(res, err);
  }
});

app.put('/api/fleets/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw badRequest('Invalid fleet business ID.');

    const [existingRows] = await pool.query('SELECT * FROM FleetBusiness WHERE fleet_business_id = ?', [id]);
    if (!existingRows.length) throw notFound('Fleet business not found.');
    const cur = existingRows[0];

    const business_name = req.body.business_name !== undefined ? String(req.body.business_name).trim() : cur.business_name;
    const contact_person = req.body.contact_person !== undefined ? String(req.body.contact_person).trim() : cur.contact_person;
    const business_phone = req.body.business_phone !== undefined ? String(req.body.business_phone).trim() : cur.business_phone;
    const business_email = req.body.business_email !== undefined ? String(req.body.business_email).trim() : cur.business_email;
    const operating_hours = req.body.operating_hours !== undefined
      ? (String(req.body.operating_hours).trim() || null)
      : cur.operating_hours;
    const address = req.body.address !== undefined ? String(req.body.address).trim() : cur.address;

    if (!business_name || !contact_person || !business_phone || !business_email || !address) {
      throw badRequest('Business name, contact person, phone, email, and address cannot be empty.');
    }

    await pool.query(
      `UPDATE FleetBusiness
       SET business_name = ?, contact_person = ?, business_phone = ?, business_email = ?, operating_hours = ?, address = ?
       WHERE fleet_business_id = ?`,
      [business_name, contact_person, business_phone, business_email, operating_hours, address, id]
    );
    const [rows] = await pool.query('SELECT * FROM FleetBusiness WHERE fleet_business_id = ?', [id]);
    res.json(rows[0]);
  } catch (err) {
    handleDbError(res, err);
  }
});

app.delete('/api/fleets/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw badRequest('Invalid fleet business ID.');
    const [result] = await pool.query('DELETE FROM FleetBusiness WHERE fleet_business_id = ?', [id]);
    if (result.affectedRows === 0) throw notFound('Fleet business not found.');
    res.status(204).send();
  } catch (err) {
    handleDbError(res, err);
  }
});

// ==========================================
// 3. DRIVER CRUD
// ==========================================
app.get('/api/drivers', async (req, res) => {
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

app.post('/api/drivers', async (req, res) => {
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

app.put('/api/drivers/:id', async (req, res) => {
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

app.delete('/api/drivers/:id', async (req, res) => {
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

// ==========================================
// 4. VEHICLE CRUD
// ==========================================
app.get('/api/vehicles', async (req, res) => {
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

app.post('/api/vehicles', async (req, res) => {
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

app.put('/api/vehicles/:id', async (req, res) => {
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

app.delete('/api/vehicles/:id', async (req, res) => {
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

// ==========================================
// 5. TOUR REQUEST CRUD
// ==========================================
app.get('/api/tour-requests', async (req, res) => {
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

app.post('/api/tour-requests', async (req, res) => {
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

app.put('/api/tour-requests/:id', async (req, res) => {
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

app.delete('/api/tour-requests/:id', async (req, res) => {
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

// ==========================================
// 6. BOOKING CRUD (Trigger enforced on INSERT)
// ==========================================
app.get('/api/bookings', async (req, res) => {
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

app.post('/api/bookings', async (req, res) => {
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

app.put('/api/bookings/:id', async (req, res) => {
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

app.delete('/api/bookings/:id', async (req, res) => {
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

// ==========================================
// ASSIGNMENT #5: SQL INJECTION LAB (PART A & PART B)
// ==========================================

// Part (a): Intentionally vulnerable string-concatenated SELECT
app.post('/api/sqli-lab/vulnerable', async (req, res) => {
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
app.post('/api/sqli-lab/prepared', async (req, res) => {
  const email = String(req.body.email ?? '').trim();
  const phone = String(req.body.phone ?? '').trim();

  const preparedSql =
    'SELECT customer_user_id, first_name, last_name, email, phone FROM Customer WHERE email = ? AND phone = ?';
  const boundParams = [email, phone];

  console.log('[SQLi Lab - Prepared SQL]', preparedSql, 'params=', boundParams);

  try {
    // mysql2/promise pool.execute uses MySQL prepared statements (PREPARE / EXECUTE / DEALLOCATE)
    const [rows] = await pool.execute(preparedSql, boundParams);
    res.json({ preparedSql, boundParams, rows });
  } catch (err) {
    handleDbError(res, err);
  }
});


app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

pool.query('SELECT 1')
  .then(() => console.log('[DB] MySQL connection pool verified.'))
  .catch((err) => console.error('[DB] Initial MySQL connection failed:', err.message));

app.listen(PORT, () => {
  console.log(`TourMarket Node + MySQL server running at http://localhost:${PORT}`);
});