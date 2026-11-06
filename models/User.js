const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a name'],
      trim: true,
      maxlength: [50, 'Name cannot exceed 50 characters']
    },
    email: {
      type: String,
      required: [true, 'Please provide an email'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        'Please provide a valid email address'
      ]
    },
    phone: {
      type: String,
      required: [true, 'Please provide a phone number'],
      trim: true
    },
    password: {
      type: String,
      required: [true, 'Please provide a password'],
      minlength: [6, 'Password must be at least 6 characters long']
    }
  },
  {
    timestamps: true
  }
);

// Pre-save hook to ensure password is securely hashed with bcryptjs
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }

  // Prevent double hashing if already hashed by controller
  const isAlreadyHashed = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(this.password);
  if (!isAlreadyHashed) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }
  next();
});

// Helper method to compare entered password with hashed password
userSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);

