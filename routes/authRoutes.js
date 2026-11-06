const express = require('express');
const router = express.Router();
const {
  registerUser,
  loginUser,
  getUserProfile,
  updateUserProfile
} = require('../controllers/authController');
const { verifyToken } = require('../middleware/authMiddleware');

// Public routes
router.post('/register', registerUser);
router.post('/login', loginUser);

// Protected routes (Requires Bearer Token)
router.route('/profile')
  .get(verifyToken, getUserProfile)
  .put(verifyToken, updateUserProfile);

module.exports = router;

