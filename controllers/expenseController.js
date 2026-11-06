const Expense = require('../models/Expense');
const { processUserAutoEmis } = require('../services/emiScheduler');

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

    const prompt = `Analyze this payment receipt or transaction screenshot (e.g., GPay, PhonePe, Paytm, Banking app).
Extract the key financial details and return strictly a valid JSON object with no markdown formatting, no code fences, and no explanations:
{
  "title": "<Merchant name, recipient person, or short payment description>",
  "amount": <Total transaction amount as a pure number, e.g. 150.00>,
  "category": "<One of: Food, Shopping, Utilities, Bills, Entertainment, Healthcare, Travel, Education, Personal, Others>",
  "paymentMethod": "<One of: UPI, GPay, PhonePe, Paytm, Credit Card, Debit Card, Net Banking, Others>"
}

Strict Rules:
- The "amount" property must be a pure number without any currency signs (no ₹, $, Rs, commas).
- If the merchant/recipient is unclear, use "Online Payment" or "Payment".
- If category cannot be determined, use "Others".
- If paymentMethod cannot be determined, use "UPI".`;

    // 3. Call Gemini model with prioritized models list
    const candidateModels = [
      'gemini-3.5-flash',
      'gemini-3-flash',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash'
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
        // If model is not supported or not found (404), try next candidate
        if (err.status === 404 || err.message?.includes('not found') || err.message?.includes('404')) {
          console.warn(`[Gemini AI] Model "${model}" is not available (404), trying next...`);
          continue;
        }
        throw err;
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
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    const cleanedJson = jsonMatch ? jsonMatch[0] : rawText.trim();
    const extractedData = JSON.parse(cleanedJson);

    const title = extractedData.title ? String(extractedData.title).trim() : 'Payment';
    const amount = Number(extractedData.amount);
    const category = extractedData.category ? String(extractedData.category).trim() : 'Others';
    const paymentMethod = extractedData.paymentMethod ? String(extractedData.paymentMethod).trim() : 'UPI';

    if (isNaN(amount) || amount <= 0) {
      return res.status(422).json({
        success: false,
        message: 'Could not detect a valid payment amount from the screenshot. Please add the expense manually.',
        rawExtracted: extractedData
      });
    }

    // 5. Automatically save new expense in MongoDB linked to req.user.id
    const expense = await Expense.create({
      user: req.user.id,
      title,
      amount,
      category,
      paymentMethod,
      date: new Date(),
      notes: `Extracted via Gemini Vision AI (${req.file.originalname || 'payment-screenshot'})`
    });

    return res.status(201).json({
      success: true,
      message: 'Payment screenshot analyzed and expense created successfully',
      extractedData: {
        title: expense.title,
        amount: expense.amount,
        category: expense.category,
        paymentMethod: expense.paymentMethod
      },
      expense
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
    const { title, amount, category, date, paymentMethod, notes } = req.body;

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

    const expense = await Expense.create({
      user: req.user.id,
      title: title.trim(),
      amount: Number(amount),
      category: category ? category.trim() : 'Others',
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

    const { category, startDate, endDate, paymentMethod, search, limit, page } = req.query;

    const query = { user: req.user.id };

    if (category) {
      query.category = category;
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
    const { title, amount, category, date, paymentMethod, notes } = req.body;

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

module.exports = {
  createExpense,
  getExpenses,
  getExpenseById,
  updateExpense,
  deleteExpense,
  uploadAndExtractExpense,
  syncEmiExpenses
};

