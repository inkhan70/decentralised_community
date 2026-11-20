const fs = require('fs');
const path = require('path');
const h = require('./helpers/harness');
const dir = h.setEnv({ VERIFICATION_THRESHOLD: '2' });

// A database file as written by v1.1: no status/endorsements/closes_at/created_by_id/messages.
const legacy = {
  users: [
    { id: '1'.repeat(24), username: 'old_timer', password_hash: 'x', fullname: 'Old Timer', trade: 'masons', contact_number: '', personal_balance: 100, createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' }
  ],
  ledger: [
    { id: '2'.repeat(24), user_id: '1'.repeat(24), amount: 100, trade: 'masons', description: 'Legacy work', createdAt: '2025-01-02T00:00:00.000Z' }
  ],
  polls: [
    { id: '3'.repeat(24), title: 'Old poll', options: [{ option: 'a', votes: 2 }, { option: 'b', votes: 0 }], target_trade: 'all', is_active: true, created_by: 'old_timer', createdAt: '2025-01-03T00:00:00.000Z' }
  ],
  votes: []
};
fs.writeFileSync(process.env.LOCAL_DB_PATH, JSON.stringify(legacy));

const storage = require('../src/storage');
const ledgerService = require('../src/services/ledgerService');
const pollService = require('../src/services/pollService');
const { ServiceError } = require('../src/services/errors');

const member = (id, trade, username) => ({ id, trade, username });
let users;

beforeAll(async () => {
  await storage.connect();
  const mk = (username, trade) => storage.users.create({ username, password_hash: 'x', fullname: username, trade });
  users = {
    a: await mk('svc_a', 'doctors'),
    b: await mk('svc_b', 'masons'),
    c: await mk('svc_c', 'teachers'),
    d: await mk('svc_d', 'labors'),
    e: await mk('svc_e', 'developers'),
    f: await mk('svc_f', 'carpenters')
  };
});
afterAll(async () => {
  await storage.disconnect();
  fs.rmSync(path.dirname(process.env.LOCAL_DB_PATH), { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('upgrading a v1.1 data file', () => {
  test('entries without a status still count as verified', async () => {
    expect(await storage.ledger.aggregateTotal()).toBeGreaterThanOrEqual(100);
    const rows = await ledgerService.listHistory(member(users.a.id, 'doctors', 'svc_a'), { limit: 200 });
    const old = rows.find((r) => r.description === 'Legacy work');
    expect(old).toMatchObject({ status: 'verified', amount: 100 });
    expect(await storage.messages.recent({ channel: 'all' })).toEqual([]); // new collection was created
  });

  test('legacy polls (no created_by_id, no deadline) are open and closable by their author name', async () => {
    const owner = member('1'.repeat(24), 'masons', 'old_timer');
    const view = (await pollService.listPolls(owner)).find((p) => p.title === 'Old poll');
    expect(view).toMatchObject({ isOpen: true, closesAt: null });
    const closed = await pollService.closePoll(owner, '3'.repeat(24));
    expect(closed.isOpen).toBe(false);
  });
});

describe('exactly-once crediting under concurrency', () => {
  test('five simultaneous endorsements credit the contributor once, not several times', async () => {
    const author = member(users.a.id, 'doctors', 'svc_a');
    const { entry } = await ledgerService.submitContribution(author, { amount: 25, description: 'Concurrent test' });

    const endorsers = [users.b, users.c, users.d, users.e, users.f].map((u) => member(u.id, u.trade, u.username));
    const results = await Promise.allSettled(endorsers.map((u) => ledgerService.endorse(u, entry.id)));

    const verifiedNow = results.filter((r) => r.status === 'fulfilled' && r.value.becameVerified);
    expect(verifiedNow).toHaveLength(1);
    // Endorsements arriving after verification are rejected cleanly rather than counted.
    expect(results.filter((r) => r.status === 'rejected').every((r) => r.reason instanceof ServiceError)).toBe(true);

    const fresh = await storage.users.findById(users.a.id);
    expect(fresh.personal_balance).toBe(25);
  });
});

describe('poll voting integrity', () => {
  test('if the tally update fails the vote record is rolled back, so the member can retry', async () => {
    const owner = member(users.a.id, 'doctors', 'svc_a');
    const poll = await pollService.createPoll(owner, { title: 'Rollback', options: ['x', 'y'] });
    const voter = member(users.b.id, 'masons', 'svc_b');

    const spy = jest.spyOn(storage.polls, 'incrementOption').mockRejectedValueOnce(new Error('disk full'));
    await expect(pollService.castVote(voter, { pollId: poll.pollId, optionIndex: 0 })).rejects.toThrow('disk full');
    spy.mockRestore();

    // Without the rollback this would fail with "already voted" while the tally still showed 0.
    const retry = await pollService.castVote(voter, { pollId: poll.pollId, optionIndex: 0 });
    expect(retry.options[0].votes).toBe(1);
  });

  test('a poll that closes between the check and the tally rolls the vote back', async () => {
    const owner = member(users.a.id, 'doctors', 'svc_a');
    const poll = await pollService.createPoll(owner, { title: 'Race', options: ['x', 'y'] });
    const voter = member(users.c.id, 'teachers', 'svc_c');

    const spy = jest.spyOn(storage.polls, 'incrementOption').mockResolvedValueOnce(null);
    await expect(pollService.castVote(voter, { pollId: poll.pollId, optionIndex: 0 })).rejects.toThrow(/just closed/);
    spy.mockRestore();
    expect(await storage.votes.findByUser(voter.id, [poll.pollId])).toEqual({});
  });

  test('createPoll rejects every non-string target without throwing a TypeError', async () => {
    const owner = member(users.a.id, 'doctors', 'svc_a');
    for (const targetTrade of [123, true, {}, [], ['all']]) {
      await expect(pollService.createPoll(owner, { title: 't', options: ['a', 'b'], targetTrade })).rejects.toBeInstanceOf(ServiceError);
    }
  });

  test('durations are capped by MAX_POLL_DURATION_HOURS', async () => {
    const owner = member(users.a.id, 'doctors', 'svc_a');
    await expect(pollService.createPoll(owner, { title: 't', options: ['a', 'b'], durationHours: 24 * 31 })).rejects.toBeInstanceOf(ServiceError);
    await expect(pollService.createPoll(owner, { title: 't', options: ['a', 'b'], durationHours: -3 })).rejects.toBeInstanceOf(ServiceError);
  });
});

describe('chat storage', () => {
  test('keeps only the most recent CHAT_RETENTION messages per channel', async () => {
    // Local driver was connected with the default retention (2000); shrink it for this test.
    await storage.disconnect();
    await storage.connect();
    const driver = require('../src/storage/localDriver');
    await driver.disconnect();
    await driver.connect(process.env.LOCAL_DB_PATH, { retention: 5 });

    for (let i = 0; i < 9; i++) {
      await driver.messages.create({ channel: 'masons', user_id: users.b.id, username: 'svc_b', trade: 'masons', text: `m${i}` });
    }
    await driver.messages.create({ channel: 'all', user_id: users.b.id, username: 'svc_b', trade: 'masons', text: 'other channel' });

    const kept = await driver.messages.recent({ channel: 'masons', limit: 50 });
    expect(kept.map((m) => m.text)).toEqual(['m4', 'm5', 'm6', 'm7', 'm8']);
    expect(await driver.messages.recent({ channel: 'all' })).toHaveLength(1);
  });
});
