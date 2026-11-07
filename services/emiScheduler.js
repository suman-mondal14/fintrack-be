const FinancialProfile = require('../models/FinancialProfile');
const Expense = require('../models/Expense');

/**
 * Parses diverse due date formats (e.g. "7th of month", "7th", "7", "07", "15th of every month")
 * @param {string} dueDateStr
 * @returns {number|null} Day of the month (1-31) or null
 */
const parseDueDateToDay = (dueDateStr) => {
  if (!dueDateStr) return null;
  const match = String(dueDateStr).match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/i) || String(dueDateStr).match(/\d+/);
  if (!match) return null;

  const day = parseInt(match[1] || match[0], 10);
  return day >= 1 && day <= 31 ? day : null;
};

/**
 * Checks and auto-creates EMI expenses for a single user
 * @param {string} userId - User ObjectId
 * @returns {Promise<{ success: boolean, added: number, skipped: number, details: Array }>}
 */
const processUserAutoEmis = async (userId) => {
  const result = { success: true, added: 0, skipped: 0, details: [] };

  try {
    const now = new Date();
    const currentDay = now.getDate();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const currentMonthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;

    // 1. Condition: Verify if financial plan exists for current month (or fallback to latest plan)
    let profile = await FinancialProfile.findOne({ user: userId, month: currentMonthStr });
    if (!profile) {
      profile = await FinancialProfile.findOne({ user: userId }).sort({ month: -1 });
    }

    if (!profile) {
      result.details.push({ message: 'No financial plan found for user.' });
      return result;
    }

    if (!profile.emis || profile.emis.length === 0) {
      result.details.push({ message: 'No EMI entries found in financial plan.' });
      return result;
    }

    const startOfMonth = new Date(currentYear, currentMonth, 1);
    const endOfMonth = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999);

    // 2. Process each EMI in the profile
    for (const emi of profile.emis) {
      // Validate EMI fields
      if (!emi.title || typeof emi.amount !== 'number' || emi.amount <= 0) {
        result.skipped++;
        result.details.push({ emiTitle: emi.title, status: 'SKIPPED_INVALID_DATA' });
        continue;
      }

      const dueDay = parseDueDateToDay(emi.dueDate);

      if (!dueDay) {
        console.warn(`[Auto-EMI] Could not parse due date "${emi.dueDate}" for EMI: "${emi.title}"`);
        result.skipped++;
        result.details.push({ emiTitle: emi.title, status: 'SKIPPED_INVALID_DUE_DATE' });
        continue;
      }

      // Mandate condition: Add on the NEXT day (dueDay + 1)
      const triggerDay = dueDay + 1;

      // If today hasn't reached the trigger day yet in this month, skip
      if (currentDay < triggerDay) {
        result.skipped++;
        result.details.push({
          emiTitle: emi.title,
          status: 'NOT_DUE_YET',
          reason: `Due day: ${dueDay}th. Trigger day: ${triggerDay}th. Today: ${currentDay}th.`
        });
        continue;
      }

      // 3. Deduplication check: Ensure not already debited for the current month
      const existingExpense = await Expense.findOne({
        user: userId,
        $or: [
          { sourceEmiId: emi._id, date: { $gte: startOfMonth, $lte: endOfMonth } },
          {
            category: 'EMI',
            title: `EMI: ${emi.title}`,
            date: { $gte: startOfMonth, $lte: endOfMonth }
          }
        ]
      });

      if (existingExpense) {
        result.skipped++;
        result.details.push({
          emiTitle: emi.title,
          status: 'ALREADY_DEBITED',
          expenseId: existingExpense._id
        });
        continue;
      }

      // 4. Auto-add new Expense document
      const debitDate = new Date(currentYear, currentMonth, Math.min(triggerDay, 28));

      const newExpense = await Expense.create({
        user: userId,
        title: `EMI: ${emi.title}`,
        amount: emi.amount,
        category: 'EMI',
        type: 'EMI',
        paymentMethod: 'Auto-Debit',
        date: debitDate,
        isAutoDebit: true,
        sourceEmiId: emi._id,
        notes: `Auto-debited on ${triggerDay}th following mandate due date (${emi.dueDate})`
      });

      result.added++;
      result.details.push({
        emiTitle: emi.title,
        amount: emi.amount,
        status: 'DEBITED',
        expenseId: newExpense._id
      });

      console.log(`[Auto-EMI] Created expense for "${emi.title}" (₹${emi.amount}) for user: ${userId}`);
    }

    return result;
  } catch (error) {
    console.error(`[Auto-EMI] Error processing user ${userId}:`, error.message);
    result.success = false;
    result.error = error.message;
    return result;
  }
};

/**
 * Checks and processes auto-EMIs across ALL distinct users
 */
const processAllUsersAutoEmis = async () => {
  try {
    const userIds = await FinancialProfile.distinct('user', { 'emis.0': { $exists: true } });

    if (!userIds || userIds.length === 0) {
      return { totalProfiles: 0, totalAdded: 0 };
    }

    let totalAdded = 0;

    for (const userId of userIds) {
      const res = await processUserAutoEmis(userId);
      totalAdded += res.added;
    }

    if (totalAdded > 0) {
      console.log(`[Auto-EMI] Auto-debited ${totalAdded} EMI expense(s) across ${userIds.length} user(s).`);
    }

    return { totalUsers: userIds.length, totalAdded };
  } catch (error) {
    console.error('[Auto-EMI] Global processing error:', error.message);
    return { error: error.message };
  }
};

/**
 * Starts background scheduler (daily midnight cron with interval fallback)
 */
const startEmiScheduler = () => {
  // 1. Initial check shortly after server startup (5s delay to ensure MongoDB is connected)
  setTimeout(() => {
    console.log('[Auto-EMI] Running startup auto-debit EMI check...');
    processAllUsersAutoEmis();
  }, 5000);

  // 2. Schedule daily recurring job at 00:05 AM
  try {
    const cron = require('node-cron');
    // Run at 00:05 every day
    cron.schedule('5 0 * * *', () => {
      console.log('[Auto-EMI] Triggering scheduled daily EMI auto-debit run...');
      processAllUsersAutoEmis();
    });
    console.log('[Auto-EMI] Cron job scheduled for 00:05 AM daily.');
  } catch (err) {
    // Fallback to 12-hour interval if node-cron is not installed
    console.log('[Auto-EMI] node-cron not detected. Using 12-hour interval fallback.');
    setInterval(processAllUsersAutoEmis, 12 * 60 * 60 * 1000);
  }
};

module.exports = {
  parseDueDateToDay,
  processUserAutoEmis,
  processAllUsersAutoEmis,
  startEmiScheduler
};

