const config = require('../config/env');
const storage = require('../storage');
const { verifyJwt } = require('../middleware/auth');
const { ServiceError } = require('../services/errors');
const ledgerService = require('../services/ledgerService');
const pollService = require('../services/pollService');
const chatService = require('../services/chatService');
const TokenBucket = require('./rateLimit');

// eslint-disable-next-line no-console
const log = (...args) => console.log(...args);

/** Who is online right now: unique members overall and per guild. */
function computePresence(io, excludeSocketId) {
  const seen = new Map();
  for (const s of io.sockets.sockets.values()) {
    if (s.id === excludeSocketId || !s.user) continue;
    seen.set(s.user.id, s.user.trade);
  }
  const byTrade = {};
  for (const trade of seen.values()) byTrade[trade] = (byTrade[trade] || 0) + 1;
  return { online: seen.size, byTrade };
}

function attachSocketHandlers(io) {
  // --- Authentication -------------------------------------------------------
  // The token must be valid AND still belong to an existing member. The member's
  // current guild is read from storage rather than trusted from the token.
  io.use(async (socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token || typeof token !== 'string') return next(new Error('Authentication token missing'));

    try {
      const decoded = verifyJwt(token);
      const user = await storage.users.findById(decoded.id);
      if (!user) return next(new Error('Authentication failed'));
      socket.user = { id: user.id, username: user.username, trade: user.trade };
      return next();
    } catch (err) {
      return next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    const { user } = socket;
    log(`[socket] connected: ${user.username} (${user.trade})`);

    socket.join(`trade_${user.trade}`);
    socket.join('main_community');
    socket.join(`user_${user.id}`); // lets every tab/device of one member be addressed together

    const bucket = new TokenBucket({ burst: config.SOCKET_RATE_BURST, perSecond: config.SOCKET_RATE_PER_SEC });

    /**
     * Registers an event handler with the guard rails every handler needs:
     *  - rate limiting per socket
     *  - a try/catch, so a bad payload can never become an unhandled rejection
     *    (which terminates Node >= 15)
     *  - user-safe errors for ServiceError, a generic message for anything else
     *  - optional acknowledgement callbacks: `socket.emit(evt, data, (res) => ...)`
     */
    const on = (event, fn) => {
      socket.on(event, async (data, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        const fail = (message) => {
          socket.emit('error_message', message);
          reply({ ok: false, error: message });
        };
        try {
          if (!bucket.take()) return fail('You are sending requests too quickly. Please slow down.');
          const result = await fn(data);
          reply({ ok: true, ...(result || {}) });
        } catch (err) {
          if (err instanceof ServiceError) return fail(err.message);
          // eslint-disable-next-line no-console
          console.error(`[socket:${event}]`, err);
          return fail('Something went wrong. Please try again.');
        }
      });
    };

    const broadcastStats = async (newContribution) => {
      const stats = await ledgerService.getStats();
      io.to('main_community').emit('nation_balance_updated', {
        totalNationBalance: stats.nationBalance,
        byTrade: stats.byTrade,
        leaderboard: stats.leaderboard,
        pendingCount: stats.pendingCount,
        newContribution
      });
    };

    // 1. Submit work / local-currency contribution (pending until peers endorse it)
    on('submit_contribution', async (data) => {
      const { entry, becameVerified } = await ledgerService.submitContribution(user, data || {});
      io.to('main_community').emit('contribution_updated', { entry });
      if (becameVerified) await broadcastStats(entry);
      return { entry };
    });

    // 2. Endorse a teammate's contribution
    on('endorse_contribution', async (data) => {
      const { entryId } = data || {};
      if (typeof entryId !== 'string') throw new ServiceError('Invalid contribution reference.');
      const { entry, becameVerified } = await ledgerService.endorse(user, entryId);
      io.to('main_community').emit('contribution_updated', { entry });
      if (becameVerified) await broadcastStats(entry);
      return { entry };
    });

    // 3. Create a poll / proposal
    on('create_poll', async (data) => {
      const poll = await pollService.createPoll(user, data || {});
      io.to(pollService.roomForTrade(poll.targetTrade)).emit('new_poll_available', poll);
      return { poll };
    });

    // 4. Cast a vote (guild-restricted, atomic, one per member)
    on('cast_vote', async (data) => {
      const poll = await pollService.castVote(user, data || {});
      const room = pollService.roomForTrade(poll.targetTrade);
      io.to(room).emit('poll_results_updated', {
        pollId: poll.pollId,
        options: poll.options,
        totalVotes: poll.totalVotes
      });
      // Only the voter's own devices learn which option they picked.
      io.to(`user_${user.id}`).emit('vote_recorded', { pollId: poll.pollId, optionIndex: poll.myVote });
      return { pollId: poll.pollId, optionIndex: poll.myVote };
    });

    // 5. Close your own poll early
    on('close_poll', async (data) => {
      const { pollId } = data || {};
      const poll = await pollService.closePoll(user, pollId);
      io.to(pollService.roomForTrade(poll.targetTrade)).emit('poll_closed', poll);
      return { poll };
    });

    // 6. Chat: guild-only or community-wide
    on('send_message', async (data) => {
      const { view, room } = await chatService.sendMessage(user, data || {});
      io.to(room).emit('chat_message', view);
      return { message: view };
    });

    // 7. Initial state for a freshly connected client (one round trip)
    on('sync', async () => {
      const [stats, ledger, polls, guildChat, communityChat] = await Promise.all([
        ledgerService.getStats(),
        ledgerService.listHistory(user, { limit: 30 }),
        pollService.listPolls(user),
        chatService.history(user, 'guild'),
        chatService.history(user, 'community')
      ]);
      return { stats, ledger, polls, chat: { guild: guildChat, community: communityChat }, presence: computePresence(io) };
    });

    io.emit('presence_updated', computePresence(io));

    socket.on('disconnect', () => {
      log(`[socket] disconnected: ${user.username}`);
      io.emit('presence_updated', computePresence(io, socket.id));
    });
  });

  // Polls close at their deadline on their own; tell everyone who can see them.
  const sweeper = setInterval(async () => {
    try {
      if (!storage.isReady()) return;
      const closed = await pollService.sweepExpired();
      for (const poll of closed) {
        io.to(pollService.roomForTrade(poll.targetTrade)).emit('poll_closed', poll);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[poll-sweeper]', err.message);
    }
  }, config.POLL_SWEEP_INTERVAL_MS);
  sweeper.unref();

  return { stop: () => clearInterval(sweeper) };
}

module.exports = attachSocketHandlers;
module.exports.computePresence = computePresence;
