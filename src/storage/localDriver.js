const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const Mutex = require('./mutex');

class DuplicateKeyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DuplicateKeyError';
    this.code = 11000;
  }
}

const mutex = new Mutex();
let filePath = null;
let cache = null; // in-memory mirror of the JSON file, kept in sync with every write
let chatRetention = 2000;

function emptyStore() {
  return { users: [], ledger: [], polls: [], votes: [], messages: [] };
}

/** Generates an ObjectId-shaped 24-char hex id, so both storage drivers hand
 * out ids in the same format (the frontend/socket validation relies on this). */
function genId() {
  return crypto.randomBytes(12).toString('hex');
}

const nowIso = () => new Date().toISOString();
const copyPoll = (p) => ({ ...p, options: p.options.map((o) => ({ ...o })) });
const copyEntry = (e) => ({ ...e, endorsements: [...(e.endorsements || [])] });
// Entries written before peer verification existed have no `status`: they count as verified.
const isVerified = (e) => (e.status || 'verified') !== 'pending';
const isOpen = (p, now = Date.now()) => p.is_active && (!p.closes_at || new Date(p.closes_at).getTime() > now);

async function persist() {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  await fsp.writeFile(tmpPath, JSON.stringify(cache, null, 2), 'utf8');
  await fsp.rename(tmpPath, filePath); // atomic on the same filesystem
}

async function connect(dbPath, { retention } = {}) {
  filePath = dbPath;
  if (retention) chatRetention = retention;
  await fsp.mkdir(path.dirname(filePath), { recursive: true });

  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    // Merge over an empty store so files written by older versions gain any new collections.
    cache = { ...emptyStore(), ...JSON.parse(raw) };
  } catch (err) {
    if (err.code === 'ENOENT') {
      cache = emptyStore();
      await persist();
    } else {
      throw new Error(`Failed to read local storage file at ${filePath}: ${err.message}`);
    }
  }
}

async function disconnect() {
  // Let any in-flight write finish before dropping the cache.
  await mutex.runExclusive(async () => {});
  cache = null;
  filePath = null;
}

function isReady() {
  return cache !== null;
}

function assertReady() {
  if (!isReady()) throw new Error('Local storage is not connected. Call storage.connect() first.');
}

// ---------------------------------------------------------------- users
const users = {
  async create({ username, password_hash, fullname, trade, contact_number }) {
    return mutex.runExclusive(async () => {
      assertReady();
      if (cache.users.some((u) => u.username === username)) {
        throw new DuplicateKeyError('Username already exists');
      }
      const now = nowIso();
      const user = {
        id: genId(),
        username,
        password_hash,
        fullname,
        trade,
        contact_number: contact_number || '',
        personal_balance: 0,
        createdAt: now,
        updatedAt: now
      };
      cache.users.push(user);
      await persist();
      return { ...user };
    });
  },

  async findByUsername(username) {
    assertReady();
    const user = cache.users.find((u) => u.username === username);
    return user ? { ...user } : null;
  },

  async findById(id) {
    assertReady();
    const user = cache.users.find((u) => u.id === id);
    return user ? { ...user } : null;
  },

  async incrementBalance(id, amount) {
    return mutex.runExclusive(async () => {
      assertReady();
      const user = cache.users.find((u) => u.id === id);
      if (!user) return;
      user.personal_balance = (user.personal_balance || 0) + amount;
      user.updatedAt = nowIso();
      await persist();
    });
  },

  async count() {
    assertReady();
    return cache.users.length;
  },

  async topByBalance(limit = 10) {
    assertReady();
    return [...cache.users]
      .sort((a, b) => (b.personal_balance || 0) - (a.personal_balance || 0))
      .slice(0, limit)
      .map(({ id, username, fullname, trade, personal_balance }) => ({
        id,
        username,
        fullname,
        trade,
        personal_balance: personal_balance || 0
      }));
  },

  toPublic(user) {
    if (!user) return null;
    const { password_hash, ...rest } = user;
    return rest;
  }
};

// --------------------------------------------------------------- ledger
const ledger = {
  async create({ user_id, amount, trade, description, status = 'verified' }) {
    return mutex.runExclusive(async () => {
      assertReady();
      const entry = {
        id: genId(),
        user_id,
        amount,
        trade,
        description,
        status,
        endorsements: [],
        verifiedAt: status === 'verified' ? nowIso() : null,
        createdAt: nowIso()
      };
      cache.ledger.push(entry);
      await persist();
      return copyEntry(entry);
    });
  },

  async findById(id) {
    assertReady();
    const entry = cache.ledger.find((e) => e.id === id);
    return entry ? copyEntry(entry) : null;
  },

  /** status: 'pending' | 'verified' | undefined (all). `before`: ISO date cursor. */
  async list({ limit = 50, status, trade, before } = {}) {
    assertReady();
    let rows = cache.ledger;
    if (status === 'pending') rows = rows.filter((e) => !isVerified(e));
    if (status === 'verified') rows = rows.filter(isVerified);
    if (trade) rows = rows.filter((e) => e.trade === trade);
    if (before) rows = rows.filter((e) => new Date(e.createdAt) < new Date(before));

    return [...rows]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit)
      .map((entry) => {
        const user = cache.users.find((u) => u.id === entry.user_id);
        return {
          ...copyEntry(entry),
          status: entry.status || 'verified',
          user_id: user ? { id: user.id, fullname: user.fullname, username: user.username } : entry.user_id
        };
      });
  },

  /** Sum of *verified* contributions only: pending ones don't count yet. */
  async aggregateTotal() {
    assertReady();
    return cache.ledger.filter(isVerified).reduce((sum, e) => sum + e.amount, 0);
  },

  async totalsByTrade() {
    assertReady();
    const map = new Map();
    for (const e of cache.ledger.filter(isVerified)) {
      const row = map.get(e.trade) || { trade: e.trade, total: 0, count: 0 };
      row.total += e.amount;
      row.count += 1;
      map.set(e.trade, row);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  },

  async countPending() {
    assertReady();
    return cache.ledger.filter((e) => !isVerified(e)).length;
  },

  /**
   * Adds one endorsement. Returns `{ entry, verified }` where `verified` is true
   * only for the single call that tipped the entry over `threshold` (so the
   * caller credits the contributor's balance exactly once), or `{ error }` with
   * one of: not_found | not_pending | own_entry | already_endorsed.
   */
  async endorse({ id, endorser_id, threshold }) {
    return mutex.runExclusive(async () => {
      assertReady();
      const entry = cache.ledger.find((e) => e.id === id);
      if (!entry) return { error: 'not_found' };
      if (isVerified(entry)) return { error: 'not_pending' };
      if (entry.user_id === endorser_id) return { error: 'own_entry' };
      entry.endorsements = entry.endorsements || [];
      if (entry.endorsements.includes(endorser_id)) return { error: 'already_endorsed' };

      entry.endorsements.push(endorser_id);
      let verified = false;
      if (entry.endorsements.length >= threshold) {
        entry.status = 'verified';
        entry.verifiedAt = nowIso();
        verified = true;
      }
      await persist();
      return { entry: copyEntry(entry), verified };
    });
  }
};

// ---------------------------------------------------------------- polls
const polls = {
  async create({ title, options, target_trade, created_by, created_by_id, closes_at }) {
    return mutex.runExclusive(async () => {
      assertReady();
      const poll = {
        id: genId(),
        title,
        options: options.map((opt) => ({ option: opt.option, votes: 0 })),
        target_trade,
        is_active: true,
        created_by,
        created_by_id: created_by_id || null,
        closes_at: closes_at ? new Date(closes_at).toISOString() : null,
        closed_at: null,
        createdAt: nowIso()
      };
      cache.polls.push(poll);
      await persist();
      return copyPoll(poll);
    });
  },

  async findById(id) {
    assertReady();
    const poll = cache.polls.find((p) => p.id === id);
    return poll ? copyPoll(poll) : null;
  },

  /** Poll that exists AND is still open (not closed early, deadline not passed). */
  async findActiveById(id) {
    assertReady();
    const poll = cache.polls.find((p) => p.id === id && isOpen(p));
    return poll ? copyPoll(poll) : null;
  },

  /** Polls a member of `trade` may see (their guild's + community-wide), newest first. */
  async list({ trade, limit = 50 } = {}) {
    assertReady();
    return cache.polls
      .filter((p) => !trade || p.target_trade === 'all' || p.target_trade === trade)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit)
      .map(copyPoll);
  },

  /** Atomically bumps one option; returns null if the poll is closed/expired/missing. */
  async incrementOption(id, optionIndex) {
    return mutex.runExclusive(async () => {
      assertReady();
      const poll = cache.polls.find((p) => p.id === id);
      if (!poll || !isOpen(poll) || !poll.options[optionIndex]) return null;
      poll.options[optionIndex].votes += 1;
      await persist();
      return copyPoll(poll);
    });
  },

  async close(id) {
    return mutex.runExclusive(async () => {
      assertReady();
      const poll = cache.polls.find((p) => p.id === id && p.is_active);
      if (!poll) return null;
      poll.is_active = false;
      poll.closed_at = nowIso();
      await persist();
      return copyPoll(poll);
    });
  },

  /** Marks every poll whose deadline has passed as closed and returns them. */
  async closeExpired(now = new Date()) {
    return mutex.runExclusive(async () => {
      assertReady();
      const closed = [];
      for (const poll of cache.polls) {
        if (poll.is_active && poll.closes_at && new Date(poll.closes_at) <= now) {
          poll.is_active = false;
          poll.closed_at = now.toISOString();
          closed.push(copyPoll(poll));
        }
      }
      if (closed.length) await persist();
      return closed;
    });
  }
};

// ---------------------------------------------------------------- votes
const votes = {
  async create({ poll_id, user_id, option_index }) {
    return mutex.runExclusive(async () => {
      assertReady();
      if (cache.votes.some((v) => v.poll_id === poll_id && v.user_id === user_id)) {
        throw new DuplicateKeyError('You have already voted on this proposal');
      }
      cache.votes.push({ id: genId(), poll_id, user_id, option_index, createdAt: nowIso() });
      await persist();
    });
  },

  /** Compensating delete, used if the tally update fails after the vote was recorded. */
  async remove({ poll_id, user_id }) {
    return mutex.runExclusive(async () => {
      assertReady();
      const before = cache.votes.length;
      cache.votes = cache.votes.filter((v) => !(v.poll_id === poll_id && v.user_id === user_id));
      if (cache.votes.length !== before) await persist();
    });
  },

  /** { [pollId]: optionIndex } for the polls this user has voted on. */
  async findByUser(user_id, poll_ids) {
    assertReady();
    const wanted = new Set(poll_ids);
    const out = {};
    for (const v of cache.votes) {
      if (v.user_id === user_id && wanted.has(v.poll_id)) out[v.poll_id] = v.option_index;
    }
    return out;
  }
};

// ------------------------------------------------------------- messages
const messages = {
  async create({ channel, user_id, username, trade, text }) {
    return mutex.runExclusive(async () => {
      assertReady();
      const msg = { id: genId(), channel, user_id, username, trade, text, createdAt: nowIso() };
      cache.messages.push(msg);

      // Bounded history per channel: drop the oldest beyond the retention limit.
      const inChannel = cache.messages.filter((m) => m.channel === channel);
      if (inChannel.length > chatRetention) {
        const drop = new Set(inChannel.slice(0, inChannel.length - chatRetention).map((m) => m.id));
        cache.messages = cache.messages.filter((m) => !drop.has(m.id));
      }
      await persist();
      return { ...msg };
    });
  },

  /** Most recent `limit` messages of a channel, oldest first (ready to render). */
  async recent({ channel, limit = 50 }) {
    assertReady();
    return cache.messages
      .filter((m) => m.channel === channel)
      .slice(-limit)
      .map((m) => ({ ...m }));
  }
};

module.exports = {
  connect,
  disconnect,
  isReady,
  users,
  ledger,
  polls,
  votes,
  messages,
  DuplicateKeyError
};
