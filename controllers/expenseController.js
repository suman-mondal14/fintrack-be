const Expense = require('../models/Expense');
const { processUserAutoEmis } = require('../services/emiScheduler');
const { EXPENSE_CATEGORIES, normalizeCategory, determineExpenseType } = require('../config/categories');

/**
 * Initialize Google GenAI client dynamically to support both CommonJS and ESM
 */
const getGeminiClient = async () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not defined in environment variables');
  }

  try {
    const { GoogleGenAI } = await import('@google/genai');
    return new GoogleGenAI({ apiKey });
  } catch (esmError) {
    try {
      const { GoogleGenAI } = require('@google/genai');
      return new GoogleGenAI({ apiKey });
    } catch (cjsError) {
      throw new Error(
        'The @google/genai SDK is missing or not installed properly. Please run "npm install @google/genai@latest"'
      );
    }
  }
};

/**
 * @desc    Upload payment screenshot, extract details via Gemini AI, and save expense
 * @route   POST /api/expenses/upload-screenshot
 * @access  Protected (Requires Token)
 */
const uploadAndExtractExpense = async (req, res) => {
  try {
    // 1. Verify that file was uploaded in memory
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: 'Please upload a payment screenshot image (field name: "screenshot")'
      });
    }

    // 2. Prepare image data for Google Gemini Vision
    const base64Data = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;

    const ai = await getGeminiClient();

    const prompt = `Analyze this payment receipt or transaction screenshot (e.g., GPay, PhonePe, Paytm, CRED, Bank Passbook, or Banking App statement).
The image may contain a SINGLE payment receipt OR a TRANSACTION HISTORY list containing MULTIPLE transactions.
Extract EVERY individual payment/expense transaction shown and return strictly a valid JSON object with no markdown formatting, no code fences, and no explanations:
{
  "transactions": [
    {
      "title": "<Merchant name, recipient person, or short payment description>",
      "amount": <Total transaction amount as a pure number without currency signs, e.g. 40.00>,
      "category": "<Exact match from allowed categories below>",
      "type": "<One of: 'Pocket Money', 'Wish'>",
      "paymentMethod": "<One of: UPI, GPay, PhonePe, Paytm, Credit Card, Debit Card, Net Banking, Cash, Others>",
      "date": "<ISO 8601 Date string YYYY-MM-DD if visible on receipt/list, or null>"
    }
  ]
}

Allowed Categories & Classification Rules:
- "Groceries": Supermarkets, kirana, daily essentials, milk, vegetables, provisions (e.g., Apna Mart, DMart, Blinkit, Zepto, BigBasket, Instamart).
- "Entertainment": BookMyShow, cinema, movies, PVR, INOX, Netflix, Spotify, OTT subscriptions, concerts, gaming, events.
- "Food & Dining": Restaurants, food delivery, cafes, bakeries, tea stalls, dining out, Swiggy, Zomato, Starbucks, Domino's, McDonald's.
- "Shopping": E-commerce, apparel, retail stores, electronics, Amazon, Flipkart, Myntra, Ajio, Meesho, Zara, Croma.
- "Bills & Utilities": Electricity bills, water, gas, Wi-Fi, broadband, mobile recharge (Jio, Airtel, Vi), DTH, maintenance.
- "Transport": Cabs, autos, fuel, petrol pumps (HP, IndianOil, BPCL), tolls/FASTag, metro, train (IRCTC), flights, Uber, Ola, Rapido.
- "Health": Pharmacy, chemist, medical store, medicines, doctor fees, clinics, hospitals, diagnostics, Apollo, Netmeds, 1mg.
- "Education": School/college fees, coaching, tuition, courses, books, Udemy, Coursera.
- "Personal": Direct P2P transfers to individual persons, friends, or family where no business/merchant name is present (e.g., transfers to "Manish Kumar", "Mousumi Ghosh", "Rahul").
- "Others": Any uncategorized or miscellaneous payments.

Expense Type Rules:
- "Wish": E-commerce shopping (Amazon, Flipkart, Myntra, Ajio, Meesho, Zara, electronics), Movies / Cinema tickets (BookMyShow, BMS, District, PVR, INOX), OTT subscriptions, lifestyle wishlist items.
- "Pocket Money": Food & dining (Swiggy, Zomato, cafes, tea stalls, restaurants), Groceries & essentials (Apna Mart, DMart, Blinkit, Zepto, milk, vegetables), Transport (railway/IRCTC, petrol pumps, metro, cabs, auto), P2P personal transfers to individuals (friends, family), bills, medical/pharmacy, daily pocket spending.

Extraction Guidelines:
- If the screenshot shows a list / statement of multiple payments (e.g., 3 transactions), extract ALL of them into the "transactions" array.
- If it's a single payment receipt, return an array of 1 item in "transactions".
- "amount" must be a pure positive number (e.g., 40, not "₹40").
- If date is visible (e.g., "7th Nov"), assume year 2026 (or current year) -> "2026-11-07".
- Ignore incoming received money, refunds, or cashback if clearly indicated; focus on debits/payments/expenses.
- If the merchant/recipient is unclear, use "Payment".
- If paymentMethod cannot be determined, use "UPI".`;

    // 3. Call Gemini model with prioritized models list
    const candidateModels = [
      'gemini-flash-latest',
      'gemini-3-flash-preview',
      'gemini-2.5-flash-lite',
      'gemini-2.5-flash',
      'gemini-pro-latest'
    ];

    let response = null;
    let lastError = null;
    let successfulModel = null;

    for (const model of candidateModels) {
      try {
        response = await ai.models.generateContent({
          model,
          contents: [
            {
              inlineData: {
                data: base64Data,
                mimeType
              }
            },
            prompt
          ],
          config: {
            responseMimeType: 'application/json'
          }
        });

        if (response) {
          successfulModel = model;
          console.log(`[Gemini AI] Successfully extracted data using model: "${model}"`);
          break;
        }
      } catch (err) {
        lastError = err;
        console.warn(`[Gemini AI] Model "${model}" attempt failed (${err.status || err.message}), trying next...`);
        continue;
      }
    }

    // If none of the candidate models succeeded, attempt dynamic discovery of available models
    if (!response) {
      try {
        console.log('[Gemini AI] Querying list of active models available for your API key...');
        const modelsResult = await ai.models.list();
        const activeModels = [];
        if (Array.isArray(modelsResult)) {
          activeModels.push(...modelsResult.map((m) => m.name || m));
        } else if (modelsResult && (modelsResult[Symbol.asyncIterator] || modelsResult[Symbol.iterator])) {
          for await (const m of modelsResult) {
            activeModels.push(m.name || m);
          }
        }
        console.log('[Gemini AI] Available models for this key:', activeModels);

        // Try the first available generative flash or pro model from the account
        const fallbackAvailable = activeModels.find((m) =>
          typeof m === 'string' && (m.includes('flash') || m.includes('gemini'))
        );

        if (fallbackAvailable) {
          const cleanModelName = fallbackAvailable.replace(/^models\//, '');
          console.log(`[Gemini AI] Attempting fallback with discovered model: "${cleanModelName}"`);
          response = await ai.models.generateContent({
            model: cleanModelName,
            contents: [
              {
                inlineData: {
                  data: base64Data,
                  mimeType
                }
              },
              prompt
            ],
            config: {
              responseMimeType: 'application/json'
            }
          });
        }
      } catch (discoveryErr) {
        console.warn('[Gemini AI] Model discovery error:', discoveryErr.message);
      }
    }

    if (!response) {
      throw lastError || new Error('Unable to extract data with available Gemini models.');
    }

    // 4. Securely extract and parse the JSON response
    let rawText = '';
    if (typeof response.text === 'function') {
      rawText = response.text();
    } else if (response.text) {
      rawText = response.text;
    } else if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
      rawText = response.candidates[0].content.parts[0].text;
    }

    if (!rawText) {
      throw new Error('Gemini AI returned an empty response.');
    }

    // Clean potential markdown fences just in case
    const jsonMatch = rawText.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    const cleanedJson = jsonMatch ? jsonMatch[0] : rawText.trim();
    const extractedData = JSON.parse(cleanedJson);

    // Normalize extractedData into an array of items (supporting single receipt or multiple transactions)
    let rawItems = [];
    if (Array.isArray(extractedData)) {
      rawItems = extractedData;
    } else if (Array.isArray(extractedData.transactions)) {
      rawItems = extractedData.transactions;
    } else if (Array.isArray(extractedData.expenses)) {
      rawItems = extractedData.expenses;
    } else if (extractedData.title || extractedData.amount) {
      rawItems = [extractedData];
    }

    const validItems = [];
    for (const item of rawItems) {
      const amount = Number(item.amount);
      if (isNaN(amount) || amount <= 0) continue;

      const title = item.title ? String(item.title).trim() : 'Payment';
      const category = normalizeCategory(title, item.category);
      const type = determineExpenseType(category, title, item.type);
      const paymentMethod = item.paymentMethod ? String(item.paymentMethod).trim() : 'UPI';

      let date = new Date();
      if (item.date) {
        const parsedDate = new Date(item.date);
        if (!isNaN(parsedDate.getTime())) {
          date = parsedDate;
          // If screenshot only showed day/month without year, align to current year
          const currentYear = new Date().getFullYear();
          if (date.getFullYear() < currentYear) {
            date.setFullYear(currentYear);
          }
        }
      }

      validItems.push({
        title,
        amount,
        category,
        type,
        paymentMethod,
        date
      });
    }

    if (validItems.length === 0) {
      return res.status(422).json({
        success: false,
        message: 'Could not detect any valid payment transactions from the screenshot. Please add manually.',
        rawExtracted: extractedData
      });
    }

    // 5. Automatically save all extracted expenses in MongoDB linked to req.user.id
    const expensesToInsert = validItems.map((item) => ({
      user: req.user.id,
      title: item.title,
      amount: item.amount,
      category: item.category,
      type: item.type,
      paymentMethod: item.paymentMethod,
      date: item.date,
      notes: `Extracted via Gemini Vision AI (${req.file.originalname || 'payment-screenshot'})`
    }));

    const savedExpenses = await Expense.insertMany(expensesToInsert);
    const totalExtractedAmount = savedExpenses.reduce((sum, e) => sum + e.amount, 0);

    return res.status(201).json({
      success: true,
      message: savedExpenses.length === 1
        ? `Payment screenshot analyzed and expense created successfully (${savedExpenses[0].title}: ₹${savedExpenses[0].amount})`
        : `Payment screenshot analyzed: ${savedExpenses.length} transactions extracted & stored successfully (Total: ₹${totalExtractedAmount.toLocaleString('en-IN')})`,
      count: savedExpenses.length,
      totalAmount: totalExtractedAmount,
      extractedData: savedExpenses.map((e) => ({
        id: e._id,
        title: e.title,
        amount: e.amount,
        category: e.category,
        type: e.type,
        paymentMethod: e.paymentMethod,
        date: e.date
      })),
      expenses: savedExpenses,
      expense: savedExpenses[0]
    });
  } catch (error) {
    console.error('Payment Screenshot AI Extraction Error:', error);

    if (error instanceof SyntaxError) {
      return res.status(502).json({
        success: false,
        message: 'Failed to parse AI output into valid JSON',
        error: error.message
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Error processing payment screenshot with Gemini AI',
      error: error.message
    });
  }
};

/**
 * @desc    Create a new expense for logged-in user
 * @route   POST /api/expenses
 * @access  Protected (Requires Token)
 */
const createExpense = async (req, res) => {
  try {
    const { title, amount, category, type, date, paymentMethod, notes } = req.body;

    if (!title || amount === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both title and amount for the expense'
      });
    }

    if (Number(amount) < 0) {
      return res.status(400).json({
        success: false,
        message: 'Expense amount cannot be negative'
      });
    }

    const cleanCat = category ? category.trim() : 'Others';
    const cleanTitle = title.trim();
    const finalType = determineExpenseType(cleanCat, cleanTitle, type);

    const expense = await Expense.create({
      user: req.user.id,
      title: cleanTitle,
      amount: Number(amount),
      category: cleanCat,
      type: finalType,
      date: date ? new Date(date) : new Date(),
      paymentMethod: paymentMethod || 'UPI',
      notes: notes ? notes.trim() : ''
    });

    return res.status(201).json({
      success: true,
      message: 'Expense added successfully',
      expense
    });
  } catch (error) {
    console.error('Create Expense Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error creating expense',
      error: error.message
    });
  }
};

/**
 * @desc    Get all expenses for logged-in user (with optional filtering)
 * @route   GET /api/expenses
 * @access  Protected (Requires Token)
 */
const getExpenses = async (req, res) => {
  try {
    // Automatically verify and sync due EMIs on fetch
    try {
      await processUserAutoEmis(req.user.id);
    } catch (emiErr) {
      console.warn('[Auto-EMI] Quick sync warning:', emiErr.message);
    }

    const { category, type, startDate, endDate, paymentMethod, search, limit, page } = req.query;

    const query = { user: req.user.id };

    if (category) {
      query.category = category;
    }

    if (type && type !== 'all') {
      query.type = type;
    }

    if (paymentMethod) {
      query.paymentMethod = paymentMethod;
    }

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    if (search) {
      query.title = { $regex: search, $options: 'i' };
    }

    const pageSize = parseInt(limit, 10) || 50;
    const currentPage = parseInt(page, 10) || 1;
    const skip = (currentPage - 1) * pageSize;

    const [expenses, total] = await Promise.all([
      Expense.find(query)
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(pageSize),
      Expense.countDocuments(query)
    ]);

    return res.status(200).json({
      success: true,
      total,
      page: currentPage,
      totalPages: Math.ceil(total / pageSize),
      count: expenses.length,
      expenses
    });
  } catch (error) {
    console.error('Get Expenses Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error fetching expenses',
      error: error.message
    });
  }
};

/**
 * @desc    Get a single expense by ID (Owner only)
 * @route   GET /api/expenses/:id
 * @access  Protected (Requires Token)
 */
const getExpenseById = async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id);

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found'
      });
    }

    // Verify ownership
    if (expense.user.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden. You do not have permission to access this expense'
      });
    }

    return res.status(200).json({
      success: true,
      expense
    });
  } catch (error) {
    console.error('Get Expense By ID Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving expense',
      error: error.message
    });
  }
};

/**
 * @desc    Update an expense (Owner only)
 * @route   PUT /api/expenses/:id
 * @access  Protected (Requires Token)
 */
const updateExpense = async (req, res) => {
  try {
    const { title, amount, category, type, date, paymentMethod, notes } = req.body;

    let expense = await Expense.findById(req.params.id);

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found'
      });
    }

    // Verify ownership
    if (expense.user.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden. You do not have permission to modify this expense'
      });
    }

    if (title) expense.title = title.trim();
    if (amount !== undefined) expense.amount = Number(amount);
    if (category) expense.category = category.trim();
    if (type) {
      expense.type = determineExpenseType(expense.category, expense.title, type);
    }
    if (date) expense.date = new Date(date);
    if (paymentMethod) expense.paymentMethod = paymentMethod;
    if (notes !== undefined) expense.notes = notes.trim();

    const updatedExpense = await expense.save();

    return res.status(200).json({
      success: true,
      message: 'Expense updated successfully',
      expense: updatedExpense
    });
  } catch (error) {
    console.error('Update Expense Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error updating expense',
      error: error.message
    });
  }
};

/**
 * @desc    Delete an expense (Owner only)
 * @route   DELETE /api/expenses/:id
 * @access  Protected (Requires Token)
 */
const deleteExpense = async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id);

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found'
      });
    }

    // Verify ownership
    if (expense.user.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden. You do not have permission to delete this expense'
      });
    }

    await expense.deleteOne();

    return res.status(200).json({
      success: true,
      message: 'Expense deleted successfully'
    });
  } catch (error) {
    console.error('Delete Expense Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error deleting expense',
      error: error.message
    });
  }
};

/**
 * @desc    Manual endpoint to trigger EMI auto-debit sync for logged-in user
 * @route   POST /api/expenses/sync-emis
 * @access  Protected (Requires Token)
 */
const syncEmiExpenses = async (req, res) => {
  try {
    const syncResult = await processUserAutoEmis(req.user.id);
    return res.status(200).json({
      success: true,
      message: `EMI auto-debit sync completed. ${syncResult.added} new EMI expense(s) added.`,
      result: syncResult
    });
  } catch (error) {
    console.error('Sync EMI Expenses Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error syncing EMI expenses',
      error: error.message
    });
  }
};

/**
 * @desc    Get master list of standardized expense categories
 * @route   GET /api/expenses/categories
 * @access  Protected
 */
const getExpenseCategories = (req, res) => {
  return res.status(200).json({
    success: true,
    categories: EXPENSE_CATEGORIES
  });
};

module.exports = {
  createExpense,
  getExpenses,
  getExpenseById,
  updateExpense,
  deleteExpense,
  uploadAndExtractExpense,
  syncEmiExpenses,
  getExpenseCategories
};

