const express = require('express');
const verifyToken = require('../middleware/auth');
const storage = require('../storage');
const { ServiceError } = require('../services/errors');
const ledgerService = require('../services/ledgerService');
const pollService = require('../services/pollService');
const chatService = require('../services/chatService');
const config = require('../config/env');

const router = express.Router();

/** Wraps an async route: ServiceError -> its status/message, anything else -> generic 500. */
const route = (name, fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof ServiceError) return res.status(err.status).json({ error: err.message });
    // eslint-disable-next-line no-console
    console.error(`[${name}]`, err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

/** Resolves the caller from storage so the guild is current, not whatever the token says. */
async function currentUser(req) {
  const user = await storage.users.findById(req.user.id);
  if (!user) throw new ServiceError('User not found', 404);
  return { id: user.id, username: user.username, trade: user.trade, record: user };
}

// Administrator access is granted only to accounts created with the private
// deployment bootstrap key; public self-selected roles are never trusted.
async function requireAdmin(req, res, next) {
  try {
    const user = await storage.users.findById(req.user.id);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Administrator access required' });
    }
    req.adminUser = user;
    return next();
  } catch (err) {
    return res.status(500).json({ error: 'Unable to verify administrator access' });
  }
}

router.get('/admin/overview', verifyToken, requireAdmin, route('admin/overview', async (req, res) => {
  const [stats, pending, members] = await Promise.all([
    ledgerService.getStats(),
    ledgerService.listHistory({ id: req.adminUser.id }, { limit: 100, status: 'pending' }),
    storage.users.listForAdmin(100)
  ]);
  res.json({ stats, pending, members });
}));

router.get(
  '/dashboard/me',
  verifyToken,
  route('dashboard/me', async (req, res) => {
    const user = await currentUser(req);
    const totalNationBalance = await storage.ledger.aggregateTotal();
    res.json({ member: { ...storage.users.toPublic(user.record), isAdmin: user.record.role === 'admin' }, nationBalance: totalNationBalance });
  })
);

router.get(
  '/ledger/history',
  verifyToken,
  route('ledger/history', async (req, res) => {
    const user = await currentUser(req);
    const { limit, status, trade, before } = req.query;
    res.json(await ledgerService.listHistory(user, { limit, status, trade, before }));
  })
);

router.get(
  '/stats',
  verifyToken,
  route('stats', async (req, res) => {
    res.json(await ledgerService.getStats());
  })
);

router.get(
  '/polls',
  verifyToken,
  route('polls', async (req, res) => {
    const user = await currentUser(req);
    res.json(await pollService.listPolls(user));
  })
);

router.get(
  '/chat/:channel',
  verifyToken,
  route('chat', async (req, res) => {
    const user = await currentUser(req);
    res.json(await chatService.history(user, req.params.channel));
  })
);

module.exports = router;
