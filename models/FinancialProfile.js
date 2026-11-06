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
      unique: true
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

module.exports = mongoose.model('FinancialProfile', financialProfileSchema);

