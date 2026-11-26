const express = require('express');
const { pool } = require('../config/db');
const handleDbError = require('../middleware/errorHandler');

const router = express.Router();

router.get('/overview', async (req, res) => {
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

module.exports = router;