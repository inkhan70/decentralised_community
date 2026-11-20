const VALID_TRADES = ['doctors', 'labors', 'carpenters', 'technicians', 'teachers', 'developers', 'masons'];

/** True if `trade` (case-insensitive) is one of the recognised guild trades. */
function isValidTrade(trade) {
  return typeof trade === 'string' && VALID_TRADES.includes(trade.toLowerCase());
}

/** True if `value` is a finite, positive number within a sane upper bound. */
function isValidAmount(value, { max = 1_000_000 } = {}) {
  const num = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(num) && num > 0 && num <= max;
}

/** True if `value` is a non-negative integer index within `optionsLength`. */
function isValidOptionIndex(value, optionsLength) {
  const num = typeof value === 'number' ? value : parseInt(value, 10);
  return Number.isInteger(num) && num >= 0 && num < optionsLength;
}

/** True if `password` meets minimum production security requirements. */
function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 128;
}

/** True if `username` is a reasonable, safe identifier. */
function isValidUsername(username) {
  return typeof username === 'string' && /^[a-zA-Z0-9_.-]{3,32}$/.test(username);
}

/** True if `title` is a non-empty string within a sane length. */
function isValidTitle(title, maxLength = 300) {
  return typeof title === 'string' && title.trim().length > 0 && title.trim().length <= maxLength;
}

/** True if `options` is an array of 2-10 non-empty, distinct strings. */
function isValidPollOptions(options, { min = 2, max = 10 } = {}) {
  if (!Array.isArray(options) || options.length < min || options.length > max) return false;
  const cleaned = options.map((o) => (typeof o === 'string' ? o.trim() : ''));
  if (cleaned.some((o) => o.length === 0 || o.length > 200)) return false;
  const unique = new Set(cleaned.map((o) => o.toLowerCase()));
  return unique.size === cleaned.length;
}

/** True if `value` looks like a 24-char hex id (shared by both storage drivers). */
function isValidId(value) {
  return typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
}

/** True if `name` is a non-empty display name of sane length. */
function isValidFullname(name) {
  return typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 100;
}

/** Contact number is optional; when present it must be a short string. */
function isValidContactNumber(value) {
  if (value === undefined || value === null || value === '') return true;
  return typeof value === 'string' && /^[0-9+()\-.\s]{3,32}$/.test(value);
}

/** Free-text description of a contribution. */
function isValidDescription(text, maxLength = 500) {
  return typeof text === 'string' && text.trim().length > 0 && text.trim().length <= maxLength;
}

/** Chat messages: non-empty after trimming and within `maxLength`. */
function isValidChatText(text, maxLength = 500) {
  return typeof text === 'string' && text.trim().length > 0 && text.trim().length <= maxLength;
}

/**
 * Poll duration in hours: undefined/null/0 means "no deadline"; otherwise a
 * positive number no longer than `maxHours` (when maxHours > 0).
 */
function isValidDurationHours(value, maxHours = 0) {
  if (value === undefined || value === null || value === '' || value === 0) return true;
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(num) || num <= 0) return false;
  return maxHours > 0 ? num <= maxHours : true;
}

module.exports = {
  VALID_TRADES,
  isValidId,
  isValidFullname,
  isValidContactNumber,
  isValidDescription,
  isValidChatText,
  isValidDurationHours,
  isValidTrade,
  isValidAmount,
  isValidOptionIndex,
  isValidPassword,
  isValidUsername,
  isValidTitle,
  isValidPollOptions
};
