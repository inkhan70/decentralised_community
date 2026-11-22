const fs = require('fs');
const os = require('os');
const path = require('path');

const localDriver = require('../src/storage/localDriver');

function tmpDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'community-local-')), 'db.json');
}

describe('localDriver', () => {
  let dbPath;

  beforeEach(async () => {
    dbPath = tmpDbPath();
    await localDriver.connect(dbPath);
  });

  afterEach(async () => {
    await localDriver.disconnect();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  test('connect() creates the JSON file on disk', () => {
    expect(fs.existsSync(dbPath)).toBe(true);
    expect(localDriver.isReady()).toBe(true);
  });

  test('users.create() then findByUsername()/findById() round-trip', async () => {
    const user = await localDriver.users.create({
      username: 'sam',
      password_hash: 'hashed',
      fullname: 'Sam Example',
      trade: 'developers',
      contact_number: '555-1234'
    });

    expect(user.id).toMatch(/^[a-f\d]{24}$/);

    const byUsername = await localDriver.users.findByUsername('sam');
    expect(byUsername.fullname).toBe('Sam Example');

    const byId = await localDriver.users.findById(user.id);
    expect(byId.username).toBe('sam');
  });

  test('users.create() rejects a duplicate username', async () => {
    await localDriver.users.create({ username: 'dup', password_hash: 'x', fullname: 'A', trade: 'masons' });
    await expect(
      localDriver.users.create({ username: 'dup', password_hash: 'y', fullname: 'B', trade: 'masons' })
    ).rejects.toMatchObject({ code: 11000 });
  });

  test('users.toPublic() strips the password hash', async () => {
    const user = await localDriver.users.create({
      username: 'priv',
      password_hash: 'super-secret-hash',
      fullname: 'Private',
      trade: 'teachers'
    });
    const publicUser = localDriver.users.toPublic(user);
    expect(publicUser.password_hash).toBeUndefined();
    expect(publicUser.username).toBe('priv');
  });

  test('data survives a reconnect (persisted to disk)', async () => {
    await localDriver.users.create({ username: 'persisted', password_hash: 'x', fullname: 'P', trade: 'labors' });
    await localDriver.disconnect();

    await localDriver.connect(dbPath);
    const found = await localDriver.users.findByUsername('persisted');
    expect(found).not.toBeNull();
  });

  test('ledger.create() + aggregateTotal() sums all contributions', async () => {
    const user = await localDriver.users.create({ username: 'giver', password_hash: 'x', fullname: 'G', trade: 'carpenters' });
    await localDriver.ledger.create({ user_id: user.id, amount: 30, trade: 'carpenters', description: 'Built a bench' });
    await localDriver.ledger.create({ user_id: user.id, amount: 12.5, trade: 'carpenters', description: 'Fixed a fence' });

    expect(await localDriver.ledger.aggregateTotal()).toBe(42.5);

    const history = await localDriver.ledger.list({ limit: 10 });
    expect(history).toHaveLength(2);
    expect(history[0].user_id).toMatchObject({ id: user.id, fullname: 'G' });
  });

  test('polls: create, vote, and duplicate-vote rejection', async () => {
    const voter = await localDriver.users.create({ username: 'voter', password_hash: 'x', fullname: 'V', trade: 'doctors' });
    const poll = await localDriver.polls.create({
      title: 'Repaint the clinic?',
      options: [{ option: 'Yes' }, { option: 'No' }],
      target_trade: 'all',
      created_by: 'admin'
    });

    await localDriver.votes.create({ poll_id: poll.id, user_id: voter.id, option_index: 0 });
    const updated = await localDriver.polls.incrementOption(poll.id, 0);
    expect(updated.options[0].votes).toBe(1);

    await expect(
      localDriver.votes.create({ poll_id: poll.id, user_id: voter.id, option_index: 1 })
    ).rejects.toMatchObject({ code: 11000 });
  });

  test('concurrent votes on the same option are not lost (serialized writes)', async () => {
    const poll = await localDriver.polls.create({
      title: 'Concurrency check',
      options: [{ option: 'A' }, { option: 'B' }],
      target_trade: 'all',
      created_by: 'admin'
    });

    const voters = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        localDriver.users.create({ username: `voter${i}`, password_hash: 'x', fullname: `V${i}`, trade: 'doctors' })
      )
    );

    await Promise.all(
      voters.map((v) =>
        localDriver.votes
          .create({ poll_id: poll.id, user_id: v.id, option_index: 0 })
          .then(() => localDriver.polls.incrementOption(poll.id, 0))
      )
    );

    const finalPoll = await localDriver.polls.findActiveById(poll.id);
    expect(finalPoll.options[0].votes).toBe(20);
  });
});
