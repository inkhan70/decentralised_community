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

/**
 * Maps a raw driver error to a short, non-sensitive reason code plus a
 * human-readable hint. The code is safe to return to the browser (it never
 * contains the URI or credentials) and tells you which setting to fix.
 */
function classifyConnectionError(err) {
  const msg = String((err && err.message) || '');
  const name = String((err && err.name) || '');
  if (err && err.code === 'MONGO_URI_PLACEHOLDER') {
    return { reason: 'uri_placeholder', hint: 'MONGO_URI still contains a <placeholder> such as <username> or <password>. Paste the real Atlas connection string.' };
  }
  if (err && err.code === 'MONGO_URI_MISSING') {
    return { reason: 'uri_missing', hint: 'MONGO_URI is not set in the Netlify environment variables.' };
  }
  if (/bad auth|authentication failed|auth failed|AuthenticationFailed/i.test(msg) || (err && err.code === 18)) {
    return { reason: 'auth_failed', hint: 'Atlas rejected the username/password. Check the database user and URL-encode special characters in the password.' };
  }
  if (name === 'MongoParseError' || /invalid scheme|invalid connection string|must be escaped|URI malformed|Invalid URL/i.test(msg)) {
    return { reason: 'invalid_uri', hint: 'MONGO_URI is malformed. URL-encode special characters in the password (e.g. @ -> %40) and remove quotes/spaces.' };
  }
  if (/querySrv|ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) {
    return { reason: 'dns', hint: 'The Atlas hostname in MONGO_URI could not be resolved. Re-copy the connection string from Atlas.' };
  }
  if (/Server selection timed out|ReplicaSetNoPrimary|ECONNREFUSED|ETIMEDOUT|whitelist|not authorized on|Could not connect to any servers/i.test(msg) || name === 'MongooseServerSelectionError') {
    return { reason: 'network_or_allowlist', hint: 'Atlas could not be reached. In Atlas > Network Access add 0.0.0.0/0 (Netlify has no fixed IPs) and make sure the cluster is not paused.' };
  }
  return { reason: 'unknown', hint: 'See the Netlify function logs for the full error.' };
}

function assertUsableUri(uri) {
  if (!uri || !String(uri).trim()) {
    const e = new Error('MONGO_URI is empty');
    e.code = 'MONGO_URI_MISSING';
    throw e;
  }
  if (/[<>]/.test(uri)) {
    const e = new Error('MONGO_URI still contains a <placeholder>');
    e.code = 'MONGO_URI_PLACEHOLDER';
    throw e;
  }
}

async function connectDB() {
  assertUsableUri(config.MONGO_URI);
  await mongoose.connect(config.MONGO_URI, {
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
    // Serverless functions are short-lived: keep the pool small so many cold
    // starts do not exhaust the Atlas free-tier connection limit.
    maxPoolSize: 5,
    // Prefer IPv4: some serverless networks fail to reach Atlas over IPv6.
    family: 4
  });
  return mongoose.connection;
}

function isConnected() {
  return mongoose.connection.readyState === 1; // 1 = connected
}

async function disconnectDB() {
  await mongoose.disconnect();
}

module.exports = { connectDB, disconnectDB, isConnected, classifyConnectionError, mongoose };
