/**
 * Centralised environment configuration.
 * Fails fast on boot if required variables are missing or unsafe,
 * instead of limping along with insecure defaults.
 */
require('dotenv').config();
const path = require('path');
const crypto = require('crypto');

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

const INSECURE_DEFAULT_SECRETS = [
  'community_secret_key_change_in_production',
  'super_secret_jwt_key_replace_this_with_random_string_32_chars',
  'changeme',
  'secret'
];

/**
 * Parses an integer env var. Unlike `parseInt(x) || fallback`, this keeps a
 * legitimate 0 (e.g. VERIFICATION_THRESHOLD=0) instead of silently replacing it.
 */
function intEnv(name, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`Invalid ${name} "${raw}": expected an integer between ${min} and ${max}.`);
  }
  return n;
}

/** Express "trust proxy" accepts booleans, hop counts, or subnet strings. */
function parseTrustProxy(raw) {
  if (raw === undefined || raw === '') return false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  return raw;
}

function validate() {
  const missing = [];

  if (isProduction) {
    if (!process.env.JWT_SECRET) missing.push('JWT_SECRET');
    const driver = (process.env.STORAGE_DRIVER || 'mongo').toLowerCase();
    if (driver === 'mongo' && !process.env.MONGO_URI) {
      missing.push('MONGO_URI (required when STORAGE_DRIVER=mongo)');
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s) in production: ${missing.join(', ')}. ` +
        'Set them (see .env.example) before starting the server.'
    );
  }

  if (process.env.JWT_SECRET && INSECURE_DEFAULT_SECRETS.includes(process.env.JWT_SECRET)) {
    if (isProduction) {
      throw new Error('JWT_SECRET is set to a known placeholder value. Generate a real secret before running in production.');
    }
    // eslint-disable-next-line no-console
    console.warn('[config] WARNING: JWT_SECRET is a placeholder value. Do not use this in production.');
  }

  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    // eslint-disable-next-line no-console
    console.warn('[config] WARNING: JWT_SECRET is shorter than 32 characters. Use a longer, random value in production.');
  }
}

validate();

// Outside production, a missing secret used to fall back to a *publicly known*
// constant, meaning anyone could forge tokens against a dev/staging server that
// is reachable on the LAN. Use a random per-process secret instead (sessions
// simply end when the process restarts).
let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  jwtSecret = crypto.randomBytes(48).toString('hex');
  // eslint-disable-next-line no-console
  console.warn('[config] JWT_SECRET not set: using a random one-off secret. Logins will not survive a restart.');
}

const config = {
  NODE_ENV,
  isProduction,
  HOST: process.env.HOST || '0.0.0.0',
  PORT: intEnv('PORT', 3000, { min: 0, max: 65535 }),
  // Optional public-facing URL (e.g. behind a reverse proxy/CDN), shown at startup only.
  PUBLIC_URL: process.env.PUBLIC_URL || '',
  // High-entropy one-time-style bootstrap key for creating administrator accounts.
  ADMIN_SETUP_KEY: process.env.ADMIN_SETUP_KEY || '',
  // Set when running behind a reverse proxy / load balancer / tunnel so that
  // rate limiting and logs see the real client IP (e.g. "1" for one proxy hop).
  TRUST_PROXY: parseTrustProxy(process.env.TRUST_PROXY),
  JWT_SECRET: jwtSecret,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  // "mongo": remote (Atlas) or local MongoDB instance, via MONGO_URI.
  // "local": zero-setup, file-based JSON storage: no database server needed.
  STORAGE_DRIVER: (process.env.STORAGE_DRIVER || 'mongo').toLowerCase(),
  LOCAL_DB_PATH: process.env.LOCAL_DB_PATH || path.join(process.cwd(), 'data', 'community-db.json'),
  MONGO_URI: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/community_hub',
  BCRYPT_SALT_ROUNDS: intEnv('BCRYPT_SALT_ROUNDS', 12, { min: 4, max: 15 }),
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  RATE_LIMIT_WINDOW_MS: intEnv('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000, { min: 1000 }),
  RATE_LIMIT_MAX: intEnv('RATE_LIMIT_MAX', 20, { min: 1 }),

  // --- Community rules -----------------------------------------------------
  // How many *other* members must endorse a contribution before it counts
  // towards the Nation Balance. 0 = trust-based (every contribution counts
  // immediately, the pre-1.2 behaviour).
  VERIFICATION_THRESHOLD: intEnv('VERIFICATION_THRESHOLD', 2, { min: 0, max: 50 }),
  // Longest a poll may stay open, in hours (0 = polls may be open-ended).
  MAX_POLL_DURATION_HOURS: intEnv('MAX_POLL_DURATION_HOURS', 24 * 30, { min: 0 }),
  POLL_SWEEP_INTERVAL_MS: intEnv('POLL_SWEEP_INTERVAL_MS', 15_000, { min: 1000 }),

  // --- Real-time abuse protection ------------------------------------------
  // Per-socket token bucket: BURST events at once, refilled at PER_SEC.
  SOCKET_RATE_BURST: intEnv('SOCKET_RATE_BURST', 10, { min: 1 }),
  SOCKET_RATE_PER_SEC: intEnv('SOCKET_RATE_PER_SEC', 2, { min: 1 }),

  // --- Chat -----------------------------------------------------------------
  CHAT_MAX_LENGTH: intEnv('CHAT_MAX_LENGTH', 500, { min: 1, max: 5000 }),
  CHAT_HISTORY_LIMIT: intEnv('CHAT_HISTORY_LIMIT', 50, { min: 1, max: 200 }),
  // Upper bound on stored chat messages (oldest are pruned) so a chatty
  // community cannot grow the local JSON file without limit.
  CHAT_RETENTION: intEnv('CHAT_RETENTION', 2000, { min: 10 })
};

if (!['mongo', 'local'].includes(config.STORAGE_DRIVER)) {
  throw new Error(`Invalid STORAGE_DRIVER "${config.STORAGE_DRIVER}". Use "mongo" or "local".`);
}

module.exports = config;
