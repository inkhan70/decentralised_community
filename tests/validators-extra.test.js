const v = require('../src/utils/validators');

describe('new validators', () => {
  test('isValidId only accepts 24-char hex strings', () => {
    expect(v.isValidId('a'.repeat(24))).toBe(true);
    expect(v.isValidId('g'.repeat(24))).toBe(false);
    expect(v.isValidId({ $ne: null })).toBe(false);
    expect(v.isValidId(undefined)).toBe(false);
  });

  test('isValidFullname rejects non-strings, blanks and over-long names', () => {
    expect(v.isValidFullname('Ada Lovelace')).toBe(true);
    expect(v.isValidFullname({ x: 1 })).toBe(false);
    expect(v.isValidFullname('   ')).toBe(false);
    expect(v.isValidFullname('x'.repeat(101))).toBe(false);
  });

  test('isValidContactNumber is optional but strict when present', () => {
    expect(v.isValidContactNumber(undefined)).toBe(true);
    expect(v.isValidContactNumber('')).toBe(true);
    expect(v.isValidContactNumber('+92 300 1234567')).toBe(true);
    expect(v.isValidContactNumber('<script>')).toBe(false);
    expect(v.isValidContactNumber(12345)).toBe(false);
  });

  test('isValidDurationHours: empty means no deadline; otherwise positive and capped', () => {
    expect(v.isValidDurationHours(undefined, 24)).toBe(true);
    expect(v.isValidDurationHours(0, 24)).toBe(true);
    expect(v.isValidDurationHours(2.5, 24)).toBe(true);
    expect(v.isValidDurationHours(25, 24)).toBe(false);
    expect(v.isValidDurationHours(-1, 24)).toBe(false);
    expect(v.isValidDurationHours('abc', 24)).toBe(false);
    expect(v.isValidDurationHours(1000, 0)).toBe(true); // 0 cap = unlimited
  });

  test('isValidChatText / isValidDescription trim and bound', () => {
    expect(v.isValidChatText('  hi  ')).toBe(true);
    expect(v.isValidChatText('   ')).toBe(false);
    expect(v.isValidChatText(5)).toBe(false);
    expect(v.isValidChatText('x'.repeat(501), 500)).toBe(false);
    expect(v.isValidDescription('did work')).toBe(true);
    expect(v.isValidDescription('')).toBe(false);
  });
});
