const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Generate JWT Token helper
 * @param {string} userId - Mongo Document ID
 * @returns {string} Signed JWT token valid for 1 day
 */
const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: '1d'
  });
};

/**
 * @desc    Register a new user
 * @route   POST /api/auth/register
 * @access  Public
 */
const registerUser = async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    // 1. Validate required fields
    if (!name || !email || !phone || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields: name, email, phone, and password'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // 2. Check if user already exists
    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'A user with this email already exists'
      });
    }

    // 3. Hash password using bcryptjs
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 4. Save new user to MongoDB
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      phone: phone.trim(),
      password: hashedPassword
    });

    // 5. Generate token for immediate authentication
    const token = generateToken(user._id);

    return res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (error) {
    console.error('Registration Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error during registration',
      error: error.message
    });
  }
};

/**
 * @desc    Authenticate user & get token
 * @route   POST /api/auth/login
 * @access  Public
 */
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1. Validate input fields
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both email and password'
      });
    }

    // 2. Verify if user exists
    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // 3. Compare passwords using bcrypt.compare
    const isPasswordMatch = await bcrypt.compare(password, user.password);

    if (!isPasswordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // 4. Generate JWT Token
    const token = generateToken(user._id);

    // 5. Return token and user details
    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (error) {
    console.error('Login Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error during login',
      error: error.message
    });
  }
};

/**
 * @desc    Get logged-in user profile
 * @route   GET /api/auth/profile
 * @access  Protected (Requires JWT)
 */
const getUserProfile = async (req, res) => {
  try {
    // req.user.id is populated by verifyToken middleware
    const user = await User.findById(req.user.id).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (error) {
    console.error('Get Profile Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving profile',
      error: error.message
    });
  }
};

/**
 * @desc    Update logged-in user's name and phone
 * @route   PUT /api/auth/profile
 * @access  Protected (Requires JWT)
 */
const updateUserProfile = async (req, res) => {
  try {
    const { name, phone } = req.body;

    if (!name && !phone) {
      return res.status(400).json({
        success: false,
        message: 'Please provide at least one field to update (name or phone)'
      });
    }

    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update allowable fields
    if (name) user.name = name.trim();
    if (phone) user.phone = phone.trim();

    const updatedUser = await user.save();

    return res.status(200).json({
      success: true,
      message: 'User profile updated successfully',
      user: {
        id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        phone: updatedUser.phone,
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt
      }
    });
  } catch (error) {
    console.error('Update Profile Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error updating profile',
      error: error.message
    });
  }
};

module.exports = {
  registerUser,
  loginUser,
  getUserProfile,
  updateUserProfile
};

