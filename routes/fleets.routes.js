const express = require('express');
const { pool } = require('../config/db');
const handleDbError = require('../middleware/errorHandler');
const { badRequest, notFound } = require('../utils/errors');

const router = express.Router();

router.get('/', async (req, res) => {
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

router.post('/', async (req, res) => {
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

router.put('/:id', async (req, res) => {
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

router.delete('/:id', async (req, res) => {
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

module.exports = router;