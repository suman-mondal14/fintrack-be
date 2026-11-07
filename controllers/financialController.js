const FinancialProfile = require('../models/FinancialProfile');
const { processUserAutoEmis } = require('../services/emiScheduler');

/**
 * Returns current month string in YYYY-MM format (e.g. "2026-11")
 */
const getCurrentMonthString = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * Validates YYYY-MM format
 */
const isValidMonthFormat = (monthStr) => {
  return typeof monthStr === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthStr);
};

/**
 * @desc    Create or update logged-in user's financial plan for a given month
 * @route   POST /api/finances
 * @access  Protected
 */
const saveOrUpdateFinancialProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      month,
      monthlyIncome,
      emis,
      investments,
      investmentsSip,
      pocketMoneyAllocation,
      wishExpenses
    } = req.body;

    // 1. Determine target month (default: current month)
    const targetMonth = (month || req.query.month || getCurrentMonthString()).trim();

    if (!isValidMonthFormat(targetMonth)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid month format. Please use YYYY-MM format (e.g., "2026-11")'
      });
    }

    // 2. Build update payload
    const profileFields = {
      user: userId,
      month: targetMonth
    };

    if (monthlyIncome !== undefined) profileFields.monthlyIncome = Number(monthlyIncome);
    if (pocketMoneyAllocation !== undefined) profileFields.pocketMoneyAllocation = Number(pocketMoneyAllocation);
    if (Array.isArray(emis)) profileFields.emis = emis;

    // Support 'investments' (with fallback if older client sends 'investmentsSip')
    if (Array.isArray(investments)) {
      profileFields.investments = investments;
    } else if (Array.isArray(investmentsSip)) {
      profileFields.investments = investmentsSip;
    }

    if (Array.isArray(wishExpenses)) profileFields.wishExpenses = wishExpenses;

    // 3. Upsert based on (user + month)
    const profile = await FinancialProfile.findOneAndUpdate(
      { user: userId, month: targetMonth },
      {
        $set: profileFields,
        $unset: { investmentsSip: "" }
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true
      }
    );

    // 4. Trigger auto-debit evaluation if due date has arrived for this month
    try {
      await processUserAutoEmis(userId);
    } catch (emiErr) {
      console.warn('[Auto-EMI] Quick sync warning on profile save:', emiErr.message);
    }

    return res.status(200).json({
      success: true,
      message: `Financial plan for ${targetMonth} saved successfully`,
      month: targetMonth,
      profile
    });
  } catch (error) {
    console.error('Save Financial Profile Error:', error.message);

    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: messages
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Server error saving financial profile',
      error: error.message
    });
  }
};

/**
 * @desc    Get logged-in user's financial plan by month (or current month by default)
 * @route   GET /api/finances
 * @access  Protected
 */
const getFinancialProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const targetMonth = (req.query.month || req.params.month || getCurrentMonthString()).trim();

    if (!isValidMonthFormat(targetMonth)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid month format. Please use YYYY-MM format (e.g., "2026-11")'
      });
    }

    // Query specifically for the target month
    let profile = await FinancialProfile.findOne({
      user: userId,
      month: targetMonth
    }).select('-investmentsSip');

    // If no document found with targetMonth, check if there is an unversioned legacy document without 'month'
    if (!profile) {
      profile = await FinancialProfile.findOne({
        user: userId,
        month: { $exists: false }
      }).select('-investmentsSip');

      // If legacy document exists, auto-stamp it with targetMonth
      if (profile) {
        profile.month = targetMonth;
        await profile.save();
      }
    }

    if (!profile) {
      return res.status(200).json({
        success: true,
        hasProfile: false,
        month: targetMonth,
        message: `No financial plan found for ${targetMonth}. Add your plan for this month to get started.`,
        profile: null
      });
    }

    return res.status(200).json({
      success: true,
      hasProfile: true,
      month: targetMonth,
      profile
    });
  } catch (error) {
    console.error('Get Financial Profile Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving financial profile',
      error: error.message
    });
  }
};

/**
 * @desc    Get financial plan for a specific month via URL parameter (e.g. /api/finances/month/2026-11)
 * @route   GET /api/finances/month/:month
 * @access  Protected
 */
const getFinancialProfileByMonth = async (req, res) => {
  return getFinancialProfile(req, res);
};

/**
 * @desc    Get all monthly financial plans with pagination and optional year filter
 * @route   GET /api/finances/history
 * @access  Protected
 */
const getAllFinancialProfiles = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page, limit, year } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(60, Math.max(1, parseInt(limit, 10) || 12)); // default 12 months (1 year)
    const skip = (pageNum - 1) * limitNum;

    const query = { user: userId };

    if (year) {
      query.month = new RegExp(`^${year.trim()}-`);
    }

    const [plans, total] = await Promise.all([
      FinancialProfile.find(query)
        .select('-investmentsSip')
        .sort({ month: -1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      FinancialProfile.countDocuments(query)
    ]);

    return res.status(200).json({
      success: true,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      count: plans.length,
      plans
    });
  } catch (error) {
    console.error('Get All Financial Profiles Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving financial plans history',
      error: error.message
    });
  }
};

module.exports = {
  saveOrUpdateFinancialProfile,
  getFinancialProfile,
  getFinancialProfileByMonth,
  getAllFinancialProfiles,
  getCurrentMonthString
};
