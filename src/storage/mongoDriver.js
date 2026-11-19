const { connectDB, disconnectDB, isConnected, mongoose } = require('../db');
const { User, Ledger, Poll, Vote, Message } = require('../models');

class DuplicateKeyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DuplicateKeyError';
    this.code = 11000;
  }
}

let chatRetention = 2000;

const idStr = (v) => (v && v._id ? v._id.toString() : v ? v.toString() : v);

/** Converts a Mongoose document to a plain object with a stable string `id`. */
function toPlain(doc) {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject({ getters: true }) : { ...doc };
  obj.id = obj._id.toString();
  delete obj._id;
  delete obj.__v;
  for (const key of ['user_id', 'created_by_id', 'poll_id']) {
    if (obj[key] && !(obj[key] && obj[key].fullname)) obj[key] = idStr(obj[key]);
  }
  if (Array.isArray(obj.endorsements)) obj.endorsements = obj.endorsements.map(idStr);
  return obj;
}

const OPEN_FILTER = () => ({
  is_active: true,
  $or: [{ closes_at: null }, { closes_at: { $exists: false } }, { closes_at: { $gt: new Date() } }]
});

async function connect(_unused, { retention } = {}) {
  if (retention) chatRetention = retention;
  await connectDB();
}

async function disconnect() {
  await disconnectDB();
}

function isReady() {
  return isConnected();
}

// ---------------------------------------------------------------- users
const users = {
  async create({ username, password_hash, fullname, trade, contact_number }) {
    try {
      const doc = await User.create({ username, password_hash, fullname, trade, contact_number });
      return toPlain(doc);
    } catch (err) {
      if (err.code === 11000) throw new DuplicateKeyError('Username already exists');
      throw err;
    }
  },
  async findByUsername(username) {
    return toPlain(await User.findOne({ username }));
  },
  async findById(id) {
    if (!mongoose.isValidObjectId(id)) return null;
    return toPlain(await User.findById(id));
  },
  async incrementBalance(id, amount) {
    await User.findByIdAndUpdate(id, { $inc: { personal_balance: amount } });
  },
  async count() {
    return User.countDocuments();
  },
  async topByBalance(limit = 10) {
    const docs = await User.find({}, 'username fullname trade personal_balance').sort({ personal_balance: -1 }).limit(limit);
    return docs.map(toPlain);
  },
  toPublic(user) {
    if (!user) return null;
    const { password_hash, ...rest } = user;
    return rest;
  }
};

// --------------------------------------------------------------- ledger
const verifiedFilter = { status: { $ne: 'pending' } };

const ledger = {
  async create({ user_id, amount, trade, description, status = 'verified' }) {
    const doc = await Ledger.create({
      user_id,
      amount,
      trade,
      description,
      status,
      verifiedAt: status === 'verified' ? new Date() : null
    });
    return toPlain(doc);
  },

  async findById(id) {
    if (!mongoose.isValidObjectId(id)) return null;
    return toPlain(await Ledger.findById(id));
  },

  async list({ limit = 50, status, trade, before } = {}) {
    const filter = {};
    if (status === 'pending') filter.status = 'pending';
    if (status === 'verified') filter.status = { $ne: 'pending' };
    if (trade) filter.trade = trade;
    if (before) filter.createdAt = { $lt: new Date(before) };

    const docs = await Ledger.find(filter).populate('user_id', 'fullname username').sort({ createdAt: -1 }).limit(limit);
    return docs.map((d) => {
      const obj = toPlain(d);
      if (!obj.status) obj.status = 'verified';
      return obj;
    });
  },

  async aggregateTotal() {
    const result = await Ledger.aggregate([{ $match: verifiedFilter }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
    return result.length > 0 ? result[0].total : 0;
  },

  async totalsByTrade() {
    const rows = await Ledger.aggregate([
      { $match: verifiedFilter },
      { $group: { _id: '$trade', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } }
    ]);
    return rows.map((r) => ({ trade: r._id, total: r.total, count: r.count }));
  },

  async countPending() {
    return Ledger.countDocuments({ status: 'pending' });
  },

  /** See localDriver.ledger.endorse for the contract. Each step is one atomic update. */
  async endorse({ id, endorser_id, threshold }) {
    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(endorser_id)) return { error: 'not_found' };

    const updated = await Ledger.findOneAndUpdate(
      {
        _id: id,
        status: 'pending',
        user_id: { $ne: endorser_id },
        endorsements: { $ne: endorser_id }
      },
      { $addToSet: { endorsements: endorser_id } },
      { new: true }
    );

    if (!updated) {
      // Work out why, so the caller can show a precise message.
      const existing = await Ledger.findById(id);
      if (!existing) return { error: 'not_found' };
      if ((existing.status || 'verified') !== 'pending') return { error: 'not_pending' };
      if (existing.user_id.toString() === endorser_id.toString()) return { error: 'own_entry' };
      return { error: 'already_endorsed' };
    }

    let verified = false;
    let finalDoc = updated;
    if (updated.endorsements.length >= threshold) {
      // Only the caller whose update flips pending -> verified gets verified=true,
      // so the contributor is credited exactly once even under concurrent endorsements.
      const flipped = await Ledger.findOneAndUpdate(
        { _id: id, status: 'pending' },
        { $set: { status: 'verified', verifiedAt: new Date() } },
        { new: true }
      );
      if (flipped) {
        verified = true;
        finalDoc = flipped;
      } else {
        finalDoc = (await Ledger.findById(id)) || updated;
      }
    }
    return { entry: toPlain(finalDoc), verified };
  }
};

// ---------------------------------------------------------------- polls
const polls = {
  async create({ title, options, target_trade, created_by, created_by_id, closes_at }) {
    const doc = await Poll.create({
      title,
      options,
      target_trade,
      created_by,
      created_by_id: created_by_id || null,
      closes_at: closes_at || null
    });
    return toPlain(doc);
  },
  async findById(id) {
    if (!mongoose.isValidObjectId(id)) return null;
    return toPlain(await Poll.findById(id));
  },
  async findActiveById(id) {
    if (!mongoose.isValidObjectId(id)) return null;
    return toPlain(await Poll.findOne({ _id: id, ...OPEN_FILTER() }));
  },
  async list({ trade, limit = 50 } = {}) {
    const filter = trade ? { target_trade: { $in: ['all', trade] } } : {};
    const docs = await Poll.find(filter).sort({ createdAt: -1 }).limit(limit);
    return docs.map(toPlain);
  },
  async incrementOption(id, optionIndex) {
    if (!mongoose.isValidObjectId(id)) return null;
    if (!Number.isInteger(optionIndex) || optionIndex < 0) return null;
    const doc = await Poll.findOneAndUpdate(
      { _id: id, ...OPEN_FILTER(), [`options.${optionIndex}`]: { $exists: true } },
      { $inc: { [`options.${optionIndex}.votes`]: 1 } },
      { new: true }
    );
    return toPlain(doc);
  },
  async close(id) {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await Poll.findOneAndUpdate(
      { _id: id, is_active: true },
      { $set: { is_active: false, closed_at: new Date() } },
      { new: true }
    );
    return toPlain(doc);
  },
  async closeExpired(now = new Date()) {
    const candidates = await Poll.find({ is_active: true, closes_at: { $ne: null, $lte: now } }, '_id');
    const closed = [];
    for (const { _id } of candidates) {
      // Per-poll conditional update: with several server instances, only one wins each poll.
      const doc = await Poll.findOneAndUpdate(
        { _id, is_active: true },
        { $set: { is_active: false, closed_at: now } },
        { new: true }
      );
      if (doc) closed.push(toPlain(doc));
    }
    return closed;
  }
};

// ---------------------------------------------------------------- votes
const votes = {
  async create({ poll_id, user_id, option_index }) {
    try {
      await Vote.create({ poll_id, user_id, option_index });
    } catch (err) {
      if (err.code === 11000) throw new DuplicateKeyError('You have already voted on this proposal');
      throw err;
    }
  },
  async remove({ poll_id, user_id }) {
    await Vote.deleteOne({ poll_id, user_id });
  },
  async findByUser(user_id, poll_ids) {
    const valid = poll_ids.filter((p) => mongoose.isValidObjectId(p));
    if (!valid.length || !mongoose.isValidObjectId(user_id)) return {};
    const docs = await Vote.find({ user_id, poll_id: { $in: valid } });
    const out = {};
    for (const d of docs) out[d.poll_id.toString()] = d.option_index;
    return out;
  }
};

// ------------------------------------------------------------- messages
const messages = {
  async create({ channel, user_id, username, trade, text }) {
    const doc = await Message.create({ channel, user_id, username, trade, text });

    // Bounded history per channel: delete anything older than the Nth newest.
    const cutoff = await Message.find({ channel }, 'createdAt').sort({ createdAt: -1 }).skip(chatRetention).limit(1);
    if (cutoff.length) await Message.deleteMany({ channel, createdAt: { $lte: cutoff[0].createdAt } });

    return toPlain(doc);
  },
  async recent({ channel, limit = 50 }) {
    const docs = await Message.find({ channel }).sort({ createdAt: -1 }).limit(limit);
    return docs.map(toPlain).reverse();
  }
};

module.exports = { connect, disconnect, isReady, users, ledger, polls, votes, messages, DuplicateKeyError };
