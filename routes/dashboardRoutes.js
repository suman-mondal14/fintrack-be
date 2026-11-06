const express = require('express');
const router = express.Router();
const {
  getDashboardSummary,
  getExpensesByMonth,
  getExpensesByYear,
  getCategoryBreakdown,
  getRecentTransactions
} = require('../controllers/dashboardController');
const { verifyToken } = require('../middleware/authMiddleware');

// All dashboard endpoints require authentication
router.use(verifyToken);

router.get('/summary', getDashboardSummary);
router.get('/expenses-by-month', getExpensesByMonth);
router.get('/expenses-by-year', getExpensesByYear);
router.get('/category-breakdown', getCategoryBreakdown);
router.get('/recent-transactions', getRecentTransactions);

module.exports = router;

