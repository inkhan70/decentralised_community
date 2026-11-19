const config = require('../config/env');
const storage = require('../storage');
const { ServiceError } = require('./errors');
const {
  VALID_TRADES,
  isValidId,
  isValidTrade,
  isValidTitle,
  isValidPollOptions,
  isValidOptionIndex,
  isValidDurationHours
} = require('../utils/validators');

const roomForTrade = (trade) => (trade === 'all' ? 'main_community' : `trade_${trade}`);

function isOpen(poll, now = Date.now()) {
  return Boolean(poll.is_active) && (!poll.closes_at || new Date(poll.closes_at).getTime() > now);
}

/** Shapes a stored poll for clients. `myVote` is the option index the viewer chose, if any. */
function toPollView(poll, myVote) {
  const options = poll.options.map((o) => ({ option: o.option, votes: o.votes }));
  return {
    pollId: poll.id,
    title: poll.title,
    options,
    totalVotes: options.reduce((n, o) => n + o.votes, 0),
    targetTrade: poll.target_trade,
    createdBy: poll.created_by,
    createdAt: poll.createdAt,
    closesAt: poll.closes_at ? new Date(poll.closes_at).toISOString() : null,
    closedAt: poll.closed_at ? new Date(poll.closed_at).toISOString() : null,
    isOpen: isOpen(poll),
    myVote: myVote === undefined ? null : myVote
  };
}

const canParticipate = (user, poll) => poll.target_trade === 'all' || poll.target_trade === user.trade;

async function createPoll(user, data) {
  const { title, options, targetTrade, durationHours } = data || {};

  if (!isValidTitle(title)) throw new ServiceError('Poll title is required (max 300 characters).');
  if (!isValidPollOptions(options)) throw new ServiceError('Provide 2-10 unique, non-empty poll options.');

  // Type-check BEFORE calling string methods: a non-string here used to throw
  // inside an async socket handler and crash the whole process.
  if (targetTrade !== undefined && targetTrade !== null && targetTrade !== '') {
    if (typeof targetTrade !== 'string' || (targetTrade.toLowerCase() !== 'all' && !isValidTrade(targetTrade))) {
      throw new ServiceError(`Invalid target guild. Choose from: all, ${VALID_TRADES.join(', ')}`);
    }
  }
  if (!isValidDurationHours(durationHours, config.MAX_POLL_DURATION_HOURS)) {
    const max = config.MAX_POLL_DURATION_HOURS;
    throw new ServiceError(max > 0 ? `Duration must be a positive number of hours (max ${max}).` : 'Duration must be a positive number of hours.');
  }

  const target = targetTrade ? targetTrade.toLowerCase() : 'all';
  // Members may only open proposals for their own guild or for everyone.
  if (target !== 'all' && target !== user.trade) {
    throw new ServiceError('You can only create polls for your own guild or for the whole community.', 403);
  }

  const hours = durationHours ? (typeof durationHours === 'number' ? durationHours : parseFloat(durationHours)) : 0;
  const closes_at = hours > 0 ? new Date(Date.now() + hours * 3600 * 1000) : null;

  const poll = await storage.polls.create({
    title: title.trim(),
    options: options.map((opt) => ({ option: opt.trim(), votes: 0 })),
    target_trade: target,
    created_by: user.username,
    created_by_id: user.id,
    closes_at
  });
  return toPollView(poll);
}

async function castVote(user, { pollId, optionIndex } = {}) {
  if (!isValidId(pollId)) throw new ServiceError('Invalid poll reference.');

  const poll = await storage.polls.findById(pollId);
  if (!poll) throw new ServiceError('Poll not found.', 404);
  if (!canParticipate(user, poll)) throw new ServiceError('This poll is limited to another guild.', 403);
  if (!isOpen(poll)) throw new ServiceError('This poll is closed.', 409);
  if (!isValidOptionIndex(optionIndex, poll.options.length)) throw new ServiceError('Invalid option selected.');
  const idx = typeof optionIndex === 'number' ? optionIndex : parseInt(optionIndex, 10);

  // 1) Record the vote; the unique (poll,user) key rejects a second vote.
  try {
    await storage.votes.create({ poll_id: pollId, user_id: user.id, option_index: idx });
  } catch (err) {
    if (err instanceof storage.DuplicateKeyError || err.code === 11000) {
      throw new ServiceError('You have already voted on this proposal.', 409);
    }
    throw err;
  }

  // 2) Bump the tally atomically. If that fails (poll closed in between, or a
  //    storage error), undo the vote record so the two never disagree.
  let updated;
  try {
    updated = await storage.polls.incrementOption(pollId, idx);
  } catch (err) {
    await storage.votes.remove({ poll_id: pollId, user_id: user.id }).catch(() => {});
    throw err;
  }
  if (!updated) {
    await storage.votes.remove({ poll_id: pollId, user_id: user.id });
    throw new ServiceError('This poll has just closed.', 409);
  }
  return toPollView(updated, idx);
}

/** Only the member who created a poll may close it early. */
async function closePoll(user, pollId) {
  if (!isValidId(pollId)) throw new ServiceError('Invalid poll reference.');
  const poll = await storage.polls.findById(pollId);
  if (!poll) throw new ServiceError('Poll not found.', 404);
  const isOwner = poll.created_by_id ? poll.created_by_id === user.id : poll.created_by === user.username;
  if (!isOwner) throw new ServiceError('Only the poll creator can close it.', 403);
  if (!isOpen(poll)) throw new ServiceError('This poll is already closed.', 409);
  const closed = await storage.polls.close(pollId);
  if (!closed) throw new ServiceError('This poll is already closed.', 409);
  return toPollView(closed);
}

async function listPolls(user, { limit = 50 } = {}) {
  const polls = await storage.polls.list({ trade: user.trade, limit: Math.min(Math.max(limit, 1), 100) });
  const myVotes = await storage.votes.findByUser(user.id, polls.map((p) => p.id));
  return polls.map((p) => toPollView(p, myVotes[p.id]));
}

/** Closes polls whose deadline passed; returns their views so the caller can broadcast. */
async function sweepExpired() {
  const closed = await storage.polls.closeExpired(new Date());
  return closed.map((p) => toPollView(p));
}

module.exports = { createPoll, castVote, closePoll, listPolls, sweepExpired, roomForTrade, toPollView, isOpen };
