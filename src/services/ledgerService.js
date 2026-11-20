const config = require('../config/env');
const storage = require('../storage');
const { ServiceError } = require('./errors');
const { isValidAmount, isValidDescription } = require('../utils/validators');

/** Shapes a stored ledger entry for clients (no raw endorser ids leak out). */
function toEntryView(entry, viewerId) {
  const author = entry.user_id && typeof entry.user_id === 'object' ? entry.user_id : null;
  const authorId = author ? author.id : entry.user_id;
  const endorsements = entry.endorsements || [];
  return {
    id: entry.id,
    // `user_id` and `createdAt` keep the original response shape (v1.1) intact for existing API clients.
    user_id: author || authorId,
    createdAt: entry.createdAt,
    userId: authorId,
    contributorName: author ? author.username : undefined,
    trade: entry.trade,
    amount: entry.amount,
    description: entry.description,
    status: entry.status || 'verified',
    endorsementCount: endorsements.length,
    endorsementsNeeded: config.VERIFICATION_THRESHOLD,
    // Who endorsed is public within the community (it is a transparency feature);
    // clients derive "did I endorse this?" from it, so broadcasts are viewer-independent.
    endorserIds: [...endorsements],
    endorsedByMe: viewerId ? endorsements.includes(viewerId) : false,
    isMine: viewerId ? authorId === viewerId : false,
    timestamp: entry.createdAt,
    verifiedAt: entry.verifiedAt || null
  };
}

async function submitContribution(user, { amount, description }) {
  if (!isValidAmount(amount) || !isValidDescription(description)) {
    throw new ServiceError('A positive amount (max 1,000,000) and a description of 1-500 characters are required.');
  }
  const numericAmount = typeof amount === 'number' ? amount : parseFloat(amount);
  const needsVerification = config.VERIFICATION_THRESHOLD > 0;

  const entry = await storage.ledger.create({
    user_id: user.id,
    amount: numericAmount,
    trade: user.trade,
    description: description.trim(),
    status: needsVerification ? 'pending' : 'verified'
  });
  if (!needsVerification) await storage.users.incrementBalance(user.id, numericAmount);

  return { entry: { ...toEntryView(entry, user.id), contributorName: user.username }, becameVerified: !needsVerification };
}

const ENDORSE_ERRORS = {
  not_found: ['Contribution not found.', 404],
  not_pending: ['This contribution is already verified.', 409],
  own_entry: ['You cannot endorse your own contribution.', 403],
  already_endorsed: ['You have already endorsed this contribution.', 409]
};

/**
 * Records an endorsement. When it tips the contribution over the threshold the
 * contributor's balance is credited, exactly once (the storage layer reports
 * `verified: true` to a single caller only).
 */
async function endorse(user, entryId) {
  const result = await storage.ledger.endorse({
    id: entryId,
    endorser_id: user.id,
    threshold: config.VERIFICATION_THRESHOLD
  });
  if (result.error) {
    const [msg, status] = ENDORSE_ERRORS[result.error];
    throw new ServiceError(msg, status);
  }
  if (result.verified) {
    await storage.users.incrementBalance(result.entry.user_id, result.entry.amount);
  }
  const author = await storage.users.findById(result.entry.user_id);
  const view = toEntryView(result.entry, user.id);
  view.contributorName = author ? author.username : undefined;
  return { entry: view, becameVerified: result.verified };
}

async function listHistory(user, { limit = 50, status, trade, before } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const rows = await storage.ledger.list({
    limit: safeLimit,
    status: ['pending', 'verified'].includes(status) ? status : undefined,
    trade: typeof trade === 'string' && trade ? trade.toLowerCase() : undefined,
    before: before && !Number.isNaN(Date.parse(before)) ? before : undefined
  });
  return rows.map((r) => toEntryView(r, user.id));
}

async function getStats() {
  const [nationBalance, byTrade, leaderboard, members, pending] = await Promise.all([
    storage.ledger.aggregateTotal(),
    storage.ledger.totalsByTrade(),
    storage.users.topByBalance(10),
    storage.users.count(),
    storage.ledger.countPending()
  ]);
  return {
    nationBalance,
    byTrade,
    leaderboard,
    memberCount: members,
    pendingCount: pending,
    verificationThreshold: config.VERIFICATION_THRESHOLD
  };
}

module.exports = { submitContribution, endorse, listHistory, getStats, toEntryView };
