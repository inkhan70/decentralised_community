const {
  isValidTrade,
  isValidAmount,
  isValidOptionIndex,
  isValidPassword,
  isValidUsername,
  isValidTitle,
  isValidPollOptions
} = require('../src/utils/validators');

describe('isValidTrade', () => {
  test('accepts known trades, case-insensitively', () => {
    expect(isValidTrade('developers')).toBe(true);
    expect(isValidTrade('Doctors')).toBe(true);
  });

  test('rejects unknown or non-string trades', () => {
    expect(isValidTrade('astronauts')).toBe(false);
    expect(isValidTrade(undefined)).toBe(false);
    expect(isValidTrade(42)).toBe(false);
  });
});

describe('isValidAmount', () => {
  test('accepts positive finite numbers and numeric strings', () => {
    expect(isValidAmount(50)).toBe(true);
    expect(isValidAmount('12.5')).toBe(true);
  });

  test('rejects zero, negative, NaN, Infinity, and out-of-range values', () => {
    expect(isValidAmount(0)).toBe(false);
    expect(isValidAmount(-5)).toBe(false);
    expect(isValidAmount('not-a-number')).toBe(false);
    expect(isValidAmount(Infinity)).toBe(false);
    expect(isValidAmount(2_000_000)).toBe(false);
  });
});

describe('isValidOptionIndex', () => {
  test('accepts in-range integers', () => {
    expect(isValidOptionIndex(0, 3)).toBe(true);
    expect(isValidOptionIndex(2, 3)).toBe(true);
    expect(isValidOptionIndex('1', 3)).toBe(true);
  });

  test('rejects out-of-range, negative, or non-integer values', () => {
    expect(isValidOptionIndex(3, 3)).toBe(false);
    expect(isValidOptionIndex(-1, 3)).toBe(false);
    expect(isValidOptionIndex(1.5, 3)).toBe(false);
    expect(isValidOptionIndex('abc', 3)).toBe(false);
  });
});

describe('isValidPassword', () => {
  test('enforces an 8-128 character length', () => {
    expect(isValidPassword('short')).toBe(false);
    expect(isValidPassword('longenough1')).toBe(true);
    expect(isValidPassword('a'.repeat(129))).toBe(false);
  });
});

describe('isValidUsername', () => {
  test('accepts safe identifiers', () => {
    expect(isValidUsername('inayat_khan-1')).toBe(true);
  });

  test('rejects usernames with spaces or unsafe characters', () => {
    expect(isValidUsername('ab')).toBe(false);
    expect(isValidUsername('has space')).toBe(false);
    expect(isValidUsername('<script>')).toBe(false);
  });
});

describe('isValidTitle', () => {
  test('rejects empty/whitespace-only titles and overly long ones', () => {
    expect(isValidTitle('   ')).toBe(false);
    expect(isValidTitle('a'.repeat(301))).toBe(false);
    expect(isValidTitle('Should we build a well?')).toBe(true);
  });
});

describe('isValidPollOptions', () => {
  test('requires 2-10 unique, non-empty options', () => {
    expect(isValidPollOptions(['Yes', 'No'])).toBe(true);
    expect(isValidPollOptions(['Only one'])).toBe(false);
    expect(isValidPollOptions(['Yes', 'yes'])).toBe(false); // case-insensitive duplicate
    expect(isValidPollOptions(['', 'No'])).toBe(false);
    expect(isValidPollOptions(Array(11).fill('x').map((v, i) => v + i))).toBe(false);
  });
});
