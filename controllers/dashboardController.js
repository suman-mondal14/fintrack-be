const mongoose = require('mongoose');
const Expense = require('../models/Expense');
const FinancialProfile = require('../models/FinancialProfile');
const { processUserAutoEmis } = require('../services/emiScheduler');

/**
 * @desc    Get dashboard summary cards (Income, Expenses, Savings, Investments)
 * @route   GET /api/dashboard/summary
 * @access  Protected
 */
const getDashboardSummary = async (req, res) => {
  try {
    // Quick auto-EMI check for current user
    try {
      await processUserAutoEmis(req.user.id);
    } catch (e) {
      console.warn('[Auto-EMI] Quick sync warning on dashboard:', e.message);
    }

    const userId = new mongoose.Types.ObjectId(req.user.id);

    // Optional query params for custom month & year (default: current)
    const now = new Date();
    const year = parseInt(req.query.year, 10) || now.getFullYear();
    const month = parseInt(req.query.month, 10) || (now.getMonth() + 1); // 1-12

    // Date range for selected month
    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

    const targetMonthStr = `${year}-${String(month).padStart(2, '0')}`;

    // 1. Fetch user's financial profile for this month (fallback to most recent plan)
    let profile = await FinancialProfile.findOne({ user: req.user.id, month: targetMonthStr });
    if (!profile) {
      profile = await FinancialProfile.findOne({ user: req.user.id }).sort({ month: -1 });
    }

    const totalMonthlyIncome = profile?.monthlyIncome || 0;

    // Calculate total active investments
    const activeInvestmentsTotal = (profile?.investments || []).reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0
    );

    // 2. Aggregate monthly expenses for the user
    const expenseAggregation = await Expense.aggregate([
      {
        $match: {
          user: userId,
          date: { $gte: startOfMonth, $lte: endOfMonth }
        }
      },
      {
        $group: {
          _id: null,
          totalMonthlyExpenses: { $sum: '$amount' },
          transactionCount: { $sum: 1 }
        }
      }
    ]);

    const totalMonthlyExpenses = expenseAggregation[0]?.totalMonthlyExpenses || 0;
    const transactionCount = expenseAggregation[0]?.transactionCount || 0;

    // 3. Compute Savings
    const totalSavings = totalMonthlyIncome - totalMonthlyExpenses;
    const savingsRate = totalMonthlyIncome > 0
      ? Number(((totalSavings / totalMonthlyIncome) * 100).toFixed(1))
      : 0;

    return res.status(200).json({
      success: true,
      data: {
        period: {
          month,
          year,
          monthName: new Date(year, month - 1).toLocaleString('default', { month: 'long' })
        },
        totalMonthlyIncome,
        totalMonthlyExpenses,
        totalSavings,
        savingsRate,
        activeInvestmentsTotal,
        transactionCount,
        hasFinancialProfile: !!profile
      }
    });
  } catch (error) {
    console.error('Dashboard Summary Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving dashboard summary',
      error: error.message
    });
  }
};

/**
 * @desc    Get aggregated expenses grouped by month for a given year (12 months)
 * @route   GET /api/dashboard/expenses-by-month
 * @access  Protected
 */
const getExpensesByMonth = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();

    const startOfYear = new Date(year, 0, 1);
    const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999);

    const monthlyAggregation = await Expense.aggregate([
      {
        $match: {
          user: userId,
          date: { $gte: startOfYear, $lte: endOfYear }
        }
      },
      {
        $group: {
          _id: { $month: '$date' },
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id': 1 }
      }
    ]);

    // Format all 12 calendar months so chart gets continuous data
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const expenseMap = {};

    monthlyAggregation.forEach((item) => {
      expenseMap[item._id] = {
        totalAmount: item.totalAmount,
        count: item.count
      };
    });

    const formattedData = monthNames.map((name, index) => {
      const monthNum = index + 1;
      return {
        monthIndex: monthNum,
        month: name,
        year,
        totalAmount: expenseMap[monthNum]?.totalAmount || 0,
        count: expenseMap[monthNum]?.count || 0
      };
    });

    const yearlyTotal = formattedData.reduce((acc, curr) => acc + curr.totalAmount, 0);

    return res.status(200).json({
      success: true,
      year,
      yearlyTotal,
      data: formattedData
    });
  } catch (error) {
    console.error('Expenses By Month Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving monthly expenses',
      error: error.message
    });
  }
};

/**
 * @desc    Get aggregated expenses grouped by year
 * @route   GET /api/dashboard/expenses-by-year
 * @access  Protected
 */
const getExpensesByYear = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);

    const yearlyAggregation = await Expense.aggregate([
      {
        $match: {
          user: userId
        }
      },
      {
        $group: {
          _id: { $year: '$date' },
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id': 1 }
      },
      {
        $project: {
          _id: 0,
          year: '$_id',
          totalAmount: 1,
          count: 1
        }
      }
    ]);

    return res.status(200).json({
      success: true,
      count: yearlyAggregation.length,
      data: yearlyAggregation
    });
  } catch (error) {
    console.error('Expenses By Year Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving yearly expenses',
      error: error.message
    });
  }
};

/**
 * @desc    Get expense breakdown grouped by category
 * @route   GET /api/dashboard/category-breakdown
 * @access  Protected
 */
const getCategoryBreakdown = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const { period = 'month', year, month } = req.query;

    const matchStage = { user: userId };
    const now = new Date();
    const targetYear = parseInt(year, 10) || now.getFullYear();
    const targetMonth = parseInt(month, 10) || (now.getMonth() + 1);

    // Apply date filtering based on query period
    if (period === 'month') {
      matchStage.date = {
        $gte: new Date(targetYear, targetMonth - 1, 1),
        $lte: new Date(targetYear, targetMonth, 0, 23, 59, 59, 999)
      };
    } else if (period === 'year') {
      matchStage.date = {
        $gte: new Date(targetYear, 0, 1),
        $lte: new Date(targetYear, 11, 31, 23, 59, 59, 999)
      };
    }
    // If period === 'all', no date filter is applied

    const categoryAggregation = await Expense.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$category',
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { totalAmount: -1 }
      },
      {
        $project: {
          _id: 0,
          category: '$_id',
          totalAmount: 1,
          count: 1
        }
      }
    ]);

    const totalExpense = categoryAggregation.reduce((sum, item) => sum + item.totalAmount, 0);

    const dataWithPercentage = categoryAggregation.map((item) => ({
      ...item,
      percentage: totalExpense > 0
        ? Number(((item.totalAmount / totalExpense) * 100).toFixed(1))
        : 0
    }));

    return res.status(200).json({
      success: true,
      period,
      totalExpense,
      data: dataWithPercentage
    });
  } catch (error) {
    console.error('Category Breakdown Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving category breakdown',
      error: error.message
    });
  }
};

/**
 * @desc    Get latest recent transactions for logged-in user
 * @route   GET /api/dashboard/recent-transactions
 * @access  Protected
 */
const getRecentTransactions = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 5, 50);

    const transactions = await Expense.find({ user: req.user.id })
      .sort({ date: -1, createdAt: -1 })
      .limit(limit)
      .select('title amount category date paymentMethod notes createdAt');

    return res.status(200).json({
      success: true,
      count: transactions.length,
      transactions
    });
  } catch (error) {
    console.error('Recent Transactions Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving recent transactions',
      error: error.message
    });
  }
};

module.exports = {
  getDashboardSummary,
  getExpensesByMonth,
  getExpensesByYear,
  getCategoryBreakdown,
  getRecentTransactions
};

