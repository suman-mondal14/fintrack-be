const mongoose = require('mongoose');
const Expense = require('../models/Expense');
const FinancialProfile = require('../models/FinancialProfile');
const User = require('../models/User');
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

/**
 * @desc    Get aggregated monthly savings (Income - Expenses) for a given year (12 months)
 * @route   GET /api/dashboard/savings-by-month
 * @access  Protected
 */
const getSavingsByMonth = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();

    // Retrieve user's account creation date to restrict phantom records before signup
    let userCreatedAt = req.user.createdAt;
    if (!userCreatedAt) {
      const u = await User.findById(req.user.id).select('createdAt');
      userCreatedAt = u?.createdAt;
    }
    const creationDate = userCreatedAt ? new Date(userCreatedAt) : null;
    const creationYear = creationDate ? creationDate.getFullYear() : null;
    const creationMonth = creationDate ? (creationDate.getMonth() + 1) : null; // 1-12

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12

    const startOfYear = new Date(year, 0, 1);
    const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999);

    // 1. Aggregate expenses by month for this year
    const monthlyExpenses = await Expense.aggregate([
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
      }
    ]);

    const expenseMap = {};
    monthlyExpenses.forEach((item) => {
      expenseMap[item._id] = {
        totalAmount: item.totalAmount,
        count: item.count
      };
    });

    // 2. Fetch all monthly plans for this year
    const yearPrefix = `${year}-`;
    const plans = await FinancialProfile.find({
      user: req.user.id,
      month: { $regex: `^${yearPrefix}` }
    }).lean();

    const planMap = {};
    plans.forEach((p) => {
      const parts = (p.month || '').split('-');
      if (parts.length === 2) {
        const mNum = parseInt(parts[1], 10);
        planMap[mNum] = p;
      }
    });

    // Fallback profile for active months that lack an explicit plan
    let fallbackProfile = await FinancialProfile.findOne({ user: req.user.id }).sort({ month: -1 }).lean();

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let yearlyIncome = 0;
    let yearlyExpenses = 0;
    let yearlySavings = 0;

    const formattedData = monthNames.map((name, index) => {
      const monthNum = index + 1;

      // Check if this month is strictly before the user account was created
      const isBeforeCreation = creationYear != null && (
        year < creationYear || (year === creationYear && monthNum < creationMonth)
      );

      // Check if this month is in the future relative to wall-clock time
      const isFuture = (year > currentYear) || (year === currentYear && monthNum > currentMonth);
      const hasPlan = !!planMap[monthNum];
      const hasExpenses = !!(expenseMap[monthNum]?.totalAmount > 0);
      const isCurrentMonth = (year === currentYear && monthNum === currentMonth);

      // 1. If month is before account creation and has no records, zero out
      if (isBeforeCreation && !hasPlan && !hasExpenses) {
        return {
          monthIndex: monthNum,
          month: name,
          year,
          income: 0,
          expense: 0,
          savings: 0,
          savingsRate: 0,
          count: 0,
          hasPlan: false,
          isBeforeCreation: true
        };
      }

      // 2. If month has no plan and no expenses, and is not the current active month:
      // Zero out! Do NOT fabricate phantom income or savings for months not in DB
      if (!hasPlan && !hasExpenses && !isCurrentMonth) {
        return {
          monthIndex: monthNum,
          month: name,
          year,
          income: 0,
          expense: 0,
          savings: 0,
          savingsRate: 0,
          count: 0,
          hasPlan: false,
          isFuture
        };
      }

      // 3. For active month or months with recorded activity/plan, compute accurately
      const activePlan = planMap[monthNum] || (isCurrentMonth ? fallbackProfile : null);
      const income = Number(activePlan?.monthlyIncome) || 0;
      const expense = expenseMap[monthNum]?.totalAmount || 0;
      const count = expenseMap[monthNum]?.count || 0;
      const savings = income - expense;
      const savingsRate = income > 0 ? Number(((savings / income) * 100).toFixed(1)) : 0;

      yearlyIncome += income;
      yearlyExpenses += expense;
      yearlySavings += savings;

      return {
        monthIndex: monthNum,
        month: name,
        year,
        income,
        expense,
        savings,
        savingsRate,
        count,
        hasPlan: !!planMap[monthNum],
        isBeforeCreation: false
      };
    });

    return res.status(200).json({
      success: true,
      year,
      yearlyIncome,
      yearlyExpenses,
      yearlySavings,
      data: formattedData
    });
  } catch (error) {
    console.error('Savings By Month Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving monthly savings',
      error: error.message
    });
  }
};

/**
 * @desc    Get aggregated savings grouped by year (strictly based on actual DB records)
 * @route   GET /api/dashboard/savings-by-year
 * @access  Protected
 */
const getSavingsByYear = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);

    let userCreatedAt = req.user.createdAt;
    if (!userCreatedAt) {
      const u = await User.findById(req.user.id).select('createdAt');
      userCreatedAt = u?.createdAt;
    }
    const creationDate = userCreatedAt ? new Date(userCreatedAt) : null;
    const creationYear = creationDate ? creationDate.getFullYear() : null;
    const creationMonth = creationDate ? (creationDate.getMonth() + 1) : null; // 1-12

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12

    // 1. Fetch all financial plans for this user from DB
    const allPlans = await FinancialProfile.find({ user: req.user.id }).lean();
    const planByMonth = {}; // e.g. "2026-11" -> plan
    const distinctYearsSet = new Set();

    allPlans.forEach((p) => {
      if (p.month) {
        planByMonth[p.month] = p;
        const y = parseInt(p.month.split('-')[0], 10);
        if (!isNaN(y)) distinctYearsSet.add(y);
      }
    });

    const fallbackProfile = allPlans.length > 0
      ? [...allPlans].sort((a, b) => (b.month || '').localeCompare(a.month || ''))[0]
      : null;

    // 2. Fetch all expenses aggregated by year and month
    const expenseAgg = await Expense.aggregate([
      { $match: { user: userId } },
      {
        $group: {
          _id: {
            year: { $year: '$date' },
            month: { $month: '$date' }
          },
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);

    const expenseByYearMonth = {}; // e.g. "2026-11" -> { totalAmount, count }
    expenseAgg.forEach((item) => {
      const y = item._id.year;
      const m = item._id.month;
      if (y) {
        distinctYearsSet.add(y);
        const key = `${y}-${String(m).padStart(2, '0')}`;
        expenseByYearMonth[key] = {
          totalAmount: item.totalAmount || 0,
          count: item.count || 0
        };
      }
    });

    // Ensure current year is always represented
    distinctYearsSet.add(currentYear);
    if (creationYear) distinctYearsSet.add(creationYear);

    const sortedYears = Array.from(distinctYearsSet).sort((a, b) => a - b);

    // 3. For each year, aggregate actual monthly income and expenses strictly from DB
    const formattedData = sortedYears.map((year) => {
      let yearIncome = 0;
      let yearExpense = 0;
      let yearCount = 0;

      for (let m = 1; m <= 12; m++) {
        const monthKey = `${year}-${String(m).padStart(2, '0')}`;
        const plan = planByMonth[monthKey];
        const expData = expenseByYearMonth[monthKey];

        const isBeforeCreation = creationYear != null && (
          year < creationYear || (year === creationYear && m < creationMonth)
        );
        const isCurrent = (year === currentYear && m === currentMonth);
        const hasPlan = !!plan;
        const hasExpenses = !!(expData && expData.totalAmount > 0);

        // Skip months before account creation with no data
        if (isBeforeCreation && !hasPlan && !hasExpenses) {
          continue;
        }

        // Skip months with no plan and no expenses that are not the current active month
        if (!hasPlan && !hasExpenses && !isCurrent) {
          continue;
        }

        const activePlan = plan || (isCurrent ? fallbackProfile : null);
        const monthIncome = Number(activePlan?.monthlyIncome) || 0;
        const monthExpense = expData?.totalAmount || 0;
        const count = expData?.count || 0;

        yearIncome += monthIncome;
        yearExpense += monthExpense;
        yearCount += count;
      }

      const savings = yearIncome - yearExpense;
      const savingsRate = yearIncome > 0
        ? Number(((savings / yearIncome) * 100).toFixed(1))
        : 0;

      return {
        year,
        income: yearIncome,
        expense: yearExpense,
        savings,
        savingsRate,
        count: yearCount
      };
    });

    // Filter to only years that have actual data or current year
    const finalData = formattedData.filter(
      (y) => y.year === currentYear || y.income > 0 || y.expense > 0 || y.count > 0
    );

    return res.status(200).json({
      success: true,
      data: finalData
    });
  } catch (error) {
    console.error('Savings By Year Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving yearly savings',
      error: error.message
    });
  }
};

module.exports = {
  getDashboardSummary,
  getExpensesByMonth,
  getExpensesByYear,
  getCategoryBreakdown,
  getRecentTransactions,
  getSavingsByMonth,
  getSavingsByYear
};

