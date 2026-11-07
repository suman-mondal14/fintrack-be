const express = require('express');
const router = express.Router();
const {
  saveOrUpdateFinancialProfile,
  getFinancialProfile,
  getFinancialProfileByMonth,
  getAllFinancialProfiles
} = require('../controllers/financialController');
const { verifyToken } = require('../middleware/authMiddleware');

// Lock ALL financial endpoints with JWT verification
router.use(verifyToken);

// 1. Get all monthly plans with pagination (e.g. /api/finances/history?page=1&limit=12&year=2026)
router.get('/history', getAllFinancialProfiles);

// 2. Get plan by URL parameter month (e.g. /api/finances/month/2026-11)
router.get('/month/:month', getFinancialProfileByMonth);

// 3. Current month plan or filtered via query (?month=YYYY-MM)
router.route('/')
  .get(getFinancialProfile)
  .post(saveOrUpdateFinancialProfile);

module.exports = router;
