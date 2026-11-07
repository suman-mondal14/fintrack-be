const mongoose = require('mongoose');

// Subdocument Schema: EMIs
const emiSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'EMI title is required'],
    trim: true
  },
  amount: {
    type: Number,
    required: [true, 'EMI amount is required'],
    min: [0, 'EMI amount must be a positive number']
  },
  dueDate: {
    type: String,
    required: [true, 'EMI due date is required'],
    trim: true
  }
});

// Subdocument Schema: Investments
const investmentSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Investment title is required'],
    trim: true
  },
  amount: {
    type: Number,
    required: [true, 'Investment amount is required'],
    min: [0, 'Investment amount must be a positive number']
  },
  frequency: {
    type: String,
    default: 'Monthly',
    trim: true
  }
});

// Subdocument Schema: Wish Expenses
const wishExpenseSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Wish expense title is required'],
    trim: true
  },
  estimatedAmount: {
    type: Number,
    required: [true, 'Estimated amount is required'],
    min: [0, 'Estimated amount must be a positive number']
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High'],
    default: 'Medium',
    trim: true
  }
});

// Main Financial Profile Schema
const financialProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    month: {
      type: String,
      required: [true, 'Month in YYYY-MM format is required (e.g., 2026-11)'],
      match: [/^\d{4}-(0[1-9]|1[0-2])$/, 'Please provide month in valid YYYY-MM format (e.g., 2026-11)'],
      default: () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      },
      index: true
    },
    monthlyIncome: {
      type: Number,
      default: 0,
      min: [0, 'Monthly income cannot be negative']
    },
    emis: [emiSchema],
    investments: [investmentSchema],
    pocketMoneyAllocation: {
      type: Number,
      default: 0,
      min: [0, 'Pocket money allocation cannot be negative']
    },
    wishExpenses: [wishExpenseSchema]
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret.investmentsSip;
        delete ret.__v;
        return ret;
      }
    },
    toObject: { virtuals: true }
  }
);

// Compound unique index: A user can only have ONE financial plan per month
financialProfileSchema.index({ user: 1, month: 1 }, { unique: true });

// Auto-migration hook: Drop legacy single-field unique index on user if present in MongoDB
mongoose.connection.on('open', async () => {
  try {
    const collection = mongoose.connection.collection('financialprofiles');
    const indexes = await collection.indexes();
    const legacyIndex = indexes.find(idx => idx.name === 'user_1' && idx.unique && !idx.key.month);
    if (legacyIndex) {
      await collection.dropIndex('user_1');
      console.log('[FinancialProfile] Dropped legacy user_1 index to enable multi-month plans.');
    }
  } catch (err) {
    // Index may already be dropped or not exist, safe to ignore
  }
});

module.exports = mongoose.model('FinancialProfile', financialProfileSchema);

