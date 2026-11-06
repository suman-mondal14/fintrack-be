const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const financialRoutes = require('./routes/financialRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const expenseRoutes = require('./routes/expenseRoutes');
const { startEmiScheduler } = require('./services/emiScheduler');

// Load environment variables from .env
dotenv.config();

// Initialize Express app
const app = express();

// Connect to Database
connectDB();

// Core Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/finances', financialRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/expenses', expenseRoutes);

// Health Check / Root Route
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'FinTrack API is up and running'
  });
});

// 404 Route Handler
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: `Resource not found: ${req.originalUrl}`
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err.stack || err.message);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

// Define Port and Start Server
const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  // Start automated EMI background scheduler
  startEmiScheduler();
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error(`Unhandled Rejection: ${err.message}`);
  // Close server & exit process
  server.close(() => process.exit(1));
});

