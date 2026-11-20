const config = require('../config/env');
const storage = require('../storage');
const { ServiceError } = require('./errors');
const { isValidChatText } = require('../utils/validators');

const CHANNELS = ['guild', 'community'];

/** Maps the client-facing channel name to the stored channel key for this member. */
function resolveChannel(user, channel) {
  if (!CHANNELS.includes(channel)) throw new ServiceError('Unknown chat channel. Use "guild" or "community".');
  return channel === 'guild' ? user.trade : 'all';
}

function toMessageView(m) {
  return {
    id: m.id,
    channel: m.channel === 'all' ? 'community' : 'guild',
    username: m.username,
    trade: m.trade,
    text: m.text,
    timestamp: m.createdAt
  };
}

async function sendMessage(user, { channel, text } = {}) {
  const key = resolveChannel(user, channel);
  if (!isValidChatText(text, config.CHAT_MAX_LENGTH)) {
    throw new ServiceError(`Messages must be 1-${config.CHAT_MAX_LENGTH} characters.`);
  }
  const saved = await storage.messages.create({
    channel: key,
    user_id: user.id,
    username: user.username,
    trade: user.trade,
    text: text.trim()
  });
  return { view: toMessageView(saved), room: key === 'all' ? 'main_community' : `trade_${key}` };
}

async function history(user, channel) {
  const key = resolveChannel(user, channel);
  const rows = await storage.messages.recent({ channel: key, limit: config.CHAT_HISTORY_LIMIT });
  return rows.map(toMessageView);
}

module.exports = { sendMessage, history, CHANNELS };
