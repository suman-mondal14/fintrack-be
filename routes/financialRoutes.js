const express = require('express');
const router = express.Router();
const {
  saveOrUpdateFinancialProfile,
  getFinancialProfile
} = require('../controllers/financialController');
const { verifyToken } = require('../middleware/authMiddleware');

// Lock ALL financial endpoints with JWT verification
router.use(verifyToken);

router.route('/')
  .get(getFinancialProfile)
  .post(saveOrUpdateFinancialProfile);

module.exports = router;
