const h = require('./helpers/harness');
h.setEnv({ VERIFICATION_THRESHOLD: '0' });

const storage = require('../src/storage');
const ledgerService = require('../src/services/ledgerService');

beforeAll(() => storage.connect());
afterAll(() => storage.disconnect());

test('VERIFICATION_THRESHOLD=0 keeps the original trust-based behaviour (0 is not treated as "unset")', async () => {
  expect(require('../src/config/env').VERIFICATION_THRESHOLD).toBe(0);
  const u = await storage.users.create({ username: 'trusting', password_hash: 'x', fullname: 'T', trade: 'masons' });
  const { entry, becameVerified } = await ledgerService.submitContribution({ id: u.id, trade: 'masons', username: 'trusting' }, { amount: 10, description: 'counts at once' });
  expect(becameVerified).toBe(true);
  expect(entry.status).toBe('verified');
  expect((await storage.users.findById(u.id)).personal_balance).toBe(10);
  expect(await storage.ledger.aggregateTotal()).toBe(10);
});
