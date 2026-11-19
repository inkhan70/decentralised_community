const { mongoose } = require('../db');
const { VALID_TRADES } = require('../utils/validators');

// 1. User Schema
const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password_hash: { type: String, required: true },
    fullname: { type: String, required: true, trim: true, maxlength: 100 },
    trade: { type: String, required: true, enum: VALID_TRADES },
    role: { type: String, enum: ['member', 'admin'], default: 'member', index: true },
    contact_number: { type: String, default: '', trim: true, maxlength: 32 },
    personal_balance: { type: Number, default: 0.0 }
  },
  { timestamps: true }
);
userSchema.index({ personal_balance: -1 }); // leaderboard

const User = mongoose.model('User', userSchema);

// 2. Ledger / Contribution Schema
// Documents written before peer verification existed have no `status`; queries
// treat "not pending" as verified so legacy data keeps counting.
const ledgerSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    trade: { type: String, required: true },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    status: { type: String, enum: ['pending', 'verified'], default: 'verified' },
    endorsements: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    verifiedAt: { type: Date, default: null }
  },
  { timestamps: true }
);
ledgerSchema.index({ createdAt: -1 });
ledgerSchema.index({ status: 1, createdAt: -1 });

const Ledger = mongoose.model('Ledger', ledgerSchema);

// 3. Poll / Proposal Schema
const pollOptionSchema = new mongoose.Schema(
  {
    option: { type: String, required: true, trim: true, maxlength: 200 },
    votes: { type: Number, default: 0, min: 0 }
  },
  { _id: false }
);

const pollSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 300 },
    options: {
      type: [pollOptionSchema],
      validate: {
        validator: (opts) => Array.isArray(opts) && opts.length >= 2 && opts.length <= 10,
        message: 'A poll must have between 2 and 10 options.'
      }
    },
    target_trade: { type: String, default: 'all' },
    is_active: { type: Boolean, default: true },
    created_by: { type: String, required: true },
    created_by_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    closes_at: { type: Date, default: null },
    closed_at: { type: Date, default: null }
  },
  { timestamps: true }
);
pollSchema.index({ is_active: 1, closes_at: 1 });

const Poll = mongoose.model('Poll', pollSchema);

// 4. Vote Tracking Schema (Prevents Double Voting)
const voteSchema = new mongoose.Schema(
  {
    poll_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Poll', required: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    option_index: { type: Number, required: true }
  },
  { timestamps: true }
);

voteSchema.index({ poll_id: 1, user_id: 1 }, { unique: true }); // Compound unique index
const Vote = mongoose.model('Vote', voteSchema);

// 5. Chat messages (one "channel" per guild, plus "all" for the whole community)
const messageSchema = new mongoose.Schema(
  {
    channel: { type: String, required: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
    trade: { type: String, required: true },
    text: { type: String, required: true, maxlength: 5000 }
  },
  { timestamps: true }
);
messageSchema.index({ channel: 1, createdAt: -1 });
const Message = mongoose.model('Message', messageSchema);

module.exports = { User, Ledger, Poll, Vote, Message };
