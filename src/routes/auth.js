const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const config = require('../config/env');
const storage = require('../storage');
const {
  VALID_TRADES,
  isValidTrade,
  isValidUsername,
  isValidPassword,
  isValidFullname,
  isValidContactNumber
} = require('../utils/validators');

const router = express.Router();

const limiterOptions = {
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' }
};

// Registration counts every attempt; login only counts FAILED attempts, so a
// member who logs in correctly many times (several devices) is never locked out
// while brute-forcing a password still is.
const registerLimiter = rateLimit(limiterOptions);
const loginLimiter = rateLimit({ ...limiterOptions, skipSuccessfulRequests: true });

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, trade: user.trade }, config.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: config.JWT_EXPIRES_IN
  });
}

// Compared against when the username does not exist, so "unknown user" costs the
// same bcrypt time as "wrong password" (prevents username enumeration by timing).
let dummyHashPromise = null;
function getDummyHash() {
  if (!dummyHashPromise) dummyHashPromise = bcrypt.hash('not-a-real-password', config.BCRYPT_SALT_ROUNDS);
  return dummyHashPromise;
}

router.post('/register', registerLimiter, async (req, res) => {
  const { username, password, fullname, trade, contact_number, adminSetupKey } = req.body || {};

  if (!username || !password || !fullname || !trade) {
    return res.status(400).json({ error: 'username, password, fullname, and trade are required' });
  }
  if (!isValidUsername(username)) {
    return res.status(400).json({ error: 'Username must be 3-32 characters (letters, numbers, ".", "_", "-").' });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: 'Password must be between 8 and 128 characters.' });
  }
  if (!isValidFullname(fullname)) {
    return res.status(400).json({ error: 'Full name must be 1-100 characters.' });
  }
  if (!isValidTrade(trade)) {
    return res.status(400).json({ error: `Invalid trade. Choose from: ${VALID_TRADES.join(', ')}` });
  }
  if (!isValidContactNumber(contact_number)) {
    return res.status(400).json({ error: 'Contact number may only contain digits, spaces and + ( ) - . (3-32 characters).' });
  }

  try {
    const usernameLower = username.toLowerCase();
    const existingUser = await storage.users.findByUsername(usernameLower);
    if (existingUser) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    const password_hash = await bcrypt.hash(password, config.BCRYPT_SALT_ROUNDS);
    const providedAdminKey = Buffer.from(typeof adminSetupKey === 'string' ? adminSetupKey : '');
    const expectedAdminKey = Buffer.from(config.ADMIN_SETUP_KEY);
    const isBootstrapAdmin = expectedAdminKey.length > 0 && providedAdminKey.length === expectedAdminKey.length && crypto.timingSafeEqual(providedAdminKey, expectedAdminKey);
    const newUser = await storage.users.create({
      username: usernameLower,
      password_hash,
      fullname: fullname.trim(),
      trade: trade.toLowerCase(),
      contact_number: contact_number ? contact_number.trim() : '',
      role: isBootstrapAdmin ? 'admin' : 'member'
    });

    const token = signToken(newUser);
    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: { id: newUser.id, username: newUser.username, fullname: newUser.fullname, trade: newUser.trade }
    });
  } catch (err) {
    if (err instanceof storage.DuplicateKeyError || err.code === 11000) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    // eslint-disable-next-line no-console
    console.error('[auth/register]', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  // bcrypt throws on non-string input, which used to surface as a 500.
  if (typeof username !== 'string' || typeof password !== 'string' || password.length > 128) {
    return res.status(400).json({ error: 'username and password must be text' });
  }

  try {
    const user = await storage.users.findByUsername(username.toLowerCase());
    const hash = user && user.password_hash ? user.password_hash : await getDummyHash();
    const passwordMatch = await bcrypt.compare(password, hash);
    if (!user || !user.password_hash || !passwordMatch) return res.status(401).json({ error: 'Invalid username or password' });

    const token = signToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        fullname: user.fullname,
        trade: user.trade,
        contact_number: user.contact_number,
        personal_balance: user.personal_balance
      }
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

module.exports = router;
