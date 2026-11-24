require('dotenv').config();
const mongoose = require('mongoose');

/**
 * Connect to MongoDB Atlas
 */
const connectDB = async () => {
  try {
    // Support MONGO_URI, MONGODB_URI (Render convention), and DATABASE_URL
    const rawUri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL;

    if (!rawUri || typeof rawUri !== 'string' || !rawUri.trim()) {
      console.error(
        '[Database Error] MongoDB connection URI is missing or undefined in environment variables.\n' +
        'Checked: process.env.MONGO_URI, process.env.MONGODB_URI, and process.env.DATABASE_URL.\n' +
        'Please verify your Render Environment Variables dashboard contains MONGO_URI or MONGODB_URI.'
      );
      process.exit(1);
    }

    // Strip accidental surrounding quotes or whitespace from dashboard copy-paste
    const mongoUri = rawUri.trim().replace(/^["']|["']$/g, '');

    const conn = await mongoose.connect(mongoUri);
    console.log(`MongoDB Connected successfully: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error(`[Database Error] MongoDB connection error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;

