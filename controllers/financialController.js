const FinancialProfile = require('../models/FinancialProfile');
const { processUserAutoEmis } = require('../services/emiScheduler');

/**
 * @desc    Create or update logged-in user's financial profile
 * @route   POST /api/finances
 * @access  Protected
 */
const saveOrUpdateFinancialProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      monthlyIncome,
      emis,
      investments,
      investmentsSip,
      pocketMoneyAllocation,
      wishExpenses
    } = req.body;

    // Build update object only with fields that are sent
    const profileFields = {
      user: userId
    };

    if (monthlyIncome !== undefined) profileFields.monthlyIncome = Number(monthlyIncome);
    if (pocketMoneyAllocation !== undefined) profileFields.pocketMoneyAllocation = Number(pocketMoneyAllocation);
    if (Array.isArray(emis)) profileFields.emis = emis;
    
    // Support both 'investments' and legacy 'investmentsSip'
    if (Array.isArray(investments)) {
      profileFields.investments = investments;
    } else if (Array.isArray(investmentsSip)) {
      profileFields.investments = investmentsSip;
    }

    if (Array.isArray(wishExpenses)) profileFields.wishExpenses = wishExpenses;

    // Upsert: update if exists, insert if not.
    // Permanently remove legacy investmentsSip field from database if present
    const profile = await FinancialProfile.findOneAndUpdate(
      { user: userId },
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

    // Trigger immediate auto-debit evaluation if any EMI due date has arrived/passed
    try {
      await processUserAutoEmis(userId);
    } catch (emiErr) {
      console.warn('[Auto-EMI] Quick sync warning on profile save:', emiErr.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Financial profile saved successfully',
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
 * @desc    Get logged-in user's financial profile
 * @route   GET /api/finances
 * @access  Protected
 */
const getFinancialProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const profile = await FinancialProfile.findOne({ user: userId }).select('-investmentsSip');

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Financial profile not found for this user'
      });
    }

    return res.status(200).json({
      success: true,
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

module.exports = {
  saveOrUpdateFinancialProfile,
  getFinancialProfile
};

