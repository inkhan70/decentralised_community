const mongoose = require('mongoose');
const config = require('./config/env');

mongoose.connection.on('connected', () => {
  // eslint-disable-next-line no-console
  console.log('[db] MongoDB connection established.');
});

mongoose.connection.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[db] MongoDB connection error:', err.message);
});

mongoose.connection.on('disconnected', () => {
  // eslint-disable-next-line no-console
  console.warn('[db] MongoDB disconnected.');
});

async function connectDB() {
  await mongoose.connect(config.MONGO_URI);
  return mongoose.connection;
}

function isConnected() {
  return mongoose.connection.readyState === 1; // 1 = connected
}

async function disconnectDB() {
  await mongoose.disconnect();
}

module.exports = { connectDB, disconnectDB, isConnected, mongoose };
