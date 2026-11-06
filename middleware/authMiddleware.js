const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Middleware to verify JWT token from Authorization header ('Bearer <token>')
 * Attaches authenticated user object to req.user
 */
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // Check if Authorization header is present and starts with 'Bearer '
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No authentication token provided or invalid header format.'
      });
    }

    // Extract token string
    const token = authHeader.split(' ')[1];

    if (!token || token.trim() === '') {
      return res.status(401).json({
        success: false,
        message: 'Access denied. Token is missing.'
      });
    }

    // Verify token using JWT_SECRET
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Verify that the user still exists in database
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid session. The user belonging to this token no longer exists.'
      });
    }

    // Attach user to request object
    req.user = user;
    req.user.id = user._id.toString();

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Authentication token has expired. Please log in again.'
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid authentication token.'
      });
    }

    return res.status(401).json({
      success: false,
      message: 'Token verification failed.',
      error: error.message
    });
  }
};

module.exports = {
  verifyToken
};
