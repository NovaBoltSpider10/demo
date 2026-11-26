const express = require('express');
const reportsRoutes = require('./reports.routes');
const customersRoutes = require('./customers.routes');
const fleetsRoutes = require('./fleets.routes');
const driversRoutes = require('./drivers.routes');
const vehiclesRoutes = require('./vehicles.routes');
const tourRequestsRoutes = require('./tourRequests.routes');
const bookingsRoutes = require('./bookings.routes');
const sqliLabRoutes = require('./sqliLab.routes');

const router = express.Router();

router.use('/reports', reportsRoutes);
router.use('/customers', customersRoutes);
router.use('/fleets', fleetsRoutes);
router.use('/drivers', driversRoutes);
router.use('/vehicles', vehiclesRoutes);
router.use('/tour-requests', tourRequestsRoutes);
router.use('/bookings', bookingsRoutes);
router.use('/sqli-lab', sqliLabRoutes);

router.use((req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

module.exports = router;