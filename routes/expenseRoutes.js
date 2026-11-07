const express = require('express');
const router = express.Router();
const {
  createExpense,
  getExpenses,
  getExpenseById,
  updateExpense,
  deleteExpense,
  uploadAndExtractExpense,
  syncEmiExpenses,
  getExpenseCategories
} = require('../controllers/expenseController');
const { verifyToken } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

// Lock ALL expense endpoints with JWT verification
router.use(verifyToken);

// AI Payment Screenshot Extraction Route (Memory Buffer -> Gemini Vision AI)
router.post('/upload-screenshot', verifyToken, upload.single('screenshot'), uploadAndExtractExpense);

// Auto-Debit EMI Synchronization Route
router.post('/sync-emis', syncEmiExpenses);

// Master List of Standardized Expense Categories
router.get('/categories', getExpenseCategories);

// Expense Collection Routes
router.route('/')
  .get(getExpenses)
  .post(createExpense);

// Individual Expense Routes
router.route('/:id')
  .get(getExpenseById)
  .put(updateExpense)
  .delete(deleteExpense);

module.exports = router;
