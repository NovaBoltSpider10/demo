require('dotenv').config();
const path = require('path');
const express = require('express');
const { verifyDbConnection } = require('./config/db');
const requestLogger = require('./middleware/logger');
const apiRoutes = require('./routes');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(requestLogger);

app.use('/api', apiRoutes);

verifyDbConnection();

app.listen(PORT, () => {
  console.log(`TourMarket Node + MySQL server running at http://localhost:${PORT}`);
});