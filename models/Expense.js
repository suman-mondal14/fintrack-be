const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    title: {
      type: String,
      required: [true, 'Please provide an expense title'],
      trim: true,
      maxlength: [100, 'Title cannot exceed 100 characters']
    },
    amount: {
      type: Number,
      required: [true, 'Please provide an amount'],
      min: [0, 'Amount must be greater than or equal to 0']
    },
    category: {
      type: String,
      required: [true, 'Please specify an expense category'],
      trim: true,
      default: 'Others'
    },
    date: {
      type: Date,
      default: Date.now,
      index: true
    },
    paymentMethod: {
      type: String,
      trim: true,
      default: 'UPI'
    },
    isAutoDebit: {
      type: Boolean,
      default: false
    },
    sourceEmiId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [250, 'Notes cannot exceed 250 characters']
    }
  },
  {
    timestamps: true
  }
);

// Compound index for user and date for fast analytics queries
expenseSchema.index({ user: 1, date: -1 });

module.exports = mongoose.model('Expense', expenseSchema);

