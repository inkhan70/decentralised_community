const config = require('../config/env');

const driver = config.STORAGE_DRIVER === 'local' ? require('./localDriver') : require('./mongoDriver');

async function connect() {
  const opts = { retention: config.CHAT_RETENTION };
  if (config.STORAGE_DRIVER === 'local') {
    await driver.connect(config.LOCAL_DB_PATH, opts);
    // eslint-disable-next-line no-console
    console.log(`[storage] Using local file storage at ${config.LOCAL_DB_PATH}`);
  } else {
    await driver.connect(null, opts);
    // eslint-disable-next-line no-console
    console.log('[storage] Using MongoDB storage.');
  }
}

module.exports = {
  driverName: config.STORAGE_DRIVER,
  connect,
  disconnect: driver.disconnect,
  isReady: driver.isReady,
  users: driver.users,
  ledger: driver.ledger,
  polls: driver.polls,
  votes: driver.votes,
  messages: driver.messages,
  DuplicateKeyError: driver.DuplicateKeyError
};
