const h = require('./helpers/harness');
h.setEnv({ VERIFICATION_THRESHOLD: '2', SOCKET_RATE_BURST: '10', SOCKET_RATE_PER_SEC: '2' });

const jwt = require('jsonwebtoken');

let srv;
let rejections = 0;
const onRejection = () => { rejections += 1; };

beforeAll(async () => {
  process.on('unhandledRejection', onRejection);
  srv = await h.startServer();
});
afterAll(async () => {
  process.off('unhandledRejection', onRejection);
  await srv.stop();
});

describe('socket authentication', () => {
  test('rejects a missing token', async () => {
    await expect(srv.connect(undefined)).rejects.toThrow(/token missing/i);
  });

  test('rejects a garbage token', async () => {
    await expect(srv.connect('nope')).rejects.toThrow(/authentication failed/i);
  });

  test('rejects a correctly signed token for a member that does not exist', async () => {
    const ghost = jwt.sign({ id: 'a'.repeat(24), username: 'ghost', trade: 'doctors' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    await expect(srv.connect(ghost)).rejects.toThrow(/authentication failed/i);
  });

  test('rejects a token signed with the "none" algorithm', async () => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const forged = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ id: 'a'.repeat(24), username: 'x', trade: 'doctors' })}.`;
    await expect(srv.connect(forged)).rejects.toThrow(/authentication failed/i);
  });
});

describe('malformed payloads can never crash the server', () => {
  test('bad create_poll / cast_vote / send_message / endorse payloads all get a clean error', async () => {
    const { token } = await h.register(srv.base, 'fuzzer', 'developers');
    const s = await srv.connect(token);

    // targetTrade: 123 used to throw inside an async handler => process crash.
    const bad = [
      ['create_poll', { title: 't', options: ['a', 'b'], targetTrade: 123 }],
      ['create_poll', { title: 't', options: ['a', 'b'], targetTrade: { x: 1 } }],
      ['create_poll', { title: 't', options: 'ab' }],
      ['create_poll', 'a string payload'],
      ['create_poll', null],
      ['cast_vote', { pollId: { $ne: null }, optionIndex: 0 }],
      ['cast_vote', { pollId: 'f'.repeat(24), optionIndex: 0 }],
      ['send_message', { channel: 'guild', text: 12345 }],
      ['send_message', { channel: 'nope', text: 'hi' }],
      ['endorse_contribution', { entryId: { a: 1 } }],
      ['submit_contribution', { amount: 'NaN', description: 'x' }],
      ['submit_contribution', { amount: -5, description: 'x' }]
    ];
    for (const [event, payload] of bad) {
      const res = await h.call(s, event, payload);
      expect(res).toMatchObject({ ok: false });
      expect(typeof res.error).toBe('string');
      expect(res.error).not.toMatch(/too quickly/i); // must be a validation error, not throttling masking it
      await h.sleep(520); // stay well inside the per-socket rate limit
    }

    const sync = await h.call(s, 'sync');
    expect(sync.ok).toBe(true); // still alive and answering
    expect(rejections).toBe(0);
  }, 20000);
});

describe('polls: guild restriction and lifecycle', () => {
  let doctor; let mason; let doctorTok; let masonTok;
  beforeAll(async () => {
    doctorTok = (await h.register(srv.base, 'dr_poll', 'doctors')).token;
    masonTok = (await h.register(srv.base, 'mason_poll', 'masons')).token;
    doctor = await srv.connect(doctorTok);
    mason = await srv.connect(masonTok);
  });

  test('a member cannot vote in another guild\'s poll (previously possible by guessing the id)', async () => {
    const { poll } = await h.call(doctor, 'create_poll', { title: 'Doctors only', options: ['yes', 'no'], targetTrade: 'doctors' });
    const res = await h.call(mason, 'cast_vote', { pollId: poll.pollId, optionIndex: 0 });
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/another guild/i) });

    const ok = await h.call(doctor, 'cast_vote', { pollId: poll.pollId, optionIndex: 1 });
    expect(ok).toMatchObject({ ok: true, optionIndex: 1 });

    const polls = (await h.call(doctor, 'sync')).polls;
    const mine = polls.find((p) => p.pollId === poll.pollId);
    expect(mine.options.map((o) => o.votes)).toEqual([0, 1]);
    expect(mine.myVote).toBe(1);
  });

  test('guild polls are not broadcast to other guilds, community polls are', async () => {
    const silent = h.expectSilence(mason, 'new_poll_available');
    await h.call(doctor, 'create_poll', { title: 'Private', options: ['a', 'b'], targetTrade: 'doctors' });
    await silent;

    const heard = h.waitFor(mason, 'new_poll_available');
    await h.sleep(520);
    await h.call(doctor, 'create_poll', { title: 'Public', options: ['a', 'b'] });
    expect((await heard).title).toBe('Public');
  });

  test('members cannot open polls for a guild they do not belong to', async () => {
    await h.sleep(520);
    const res = await h.call(mason, 'create_poll', { title: 'Meddling', options: ['a', 'b'], targetTrade: 'doctors' });
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/own guild/i) });
  });

  test('one vote per member', async () => {
    const { poll } = await h.call(doctor, 'create_poll', { title: 'Once', options: ['a', 'b'] });
    expect((await h.call(mason, 'cast_vote', { pollId: poll.pollId, optionIndex: 0 })).ok).toBe(true);
    const again = await h.call(mason, 'cast_vote', { pollId: poll.pollId, optionIndex: 1 });
    expect(again).toMatchObject({ ok: false, error: expect.stringMatching(/already voted/i) });
  });

  test('only the creator can close a poll; voting stops afterwards', async () => {
    await h.sleep(600);
    const { poll } = await h.call(doctor, 'create_poll', { title: 'Close me', options: ['a', 'b'] });
    const denied = await h.call(mason, 'close_poll', { pollId: poll.pollId });
    expect(denied).toMatchObject({ ok: false, error: expect.stringMatching(/creator/i) });

    const closedEvt = h.waitFor(mason, 'poll_closed');
    expect((await h.call(doctor, 'close_poll', { pollId: poll.pollId })).ok).toBe(true);
    expect((await closedEvt).isOpen).toBe(false);

    const late = await h.call(mason, 'cast_vote', { pollId: poll.pollId, optionIndex: 0 });
    expect(late).toMatchObject({ ok: false, error: expect.stringMatching(/closed/i) });
  }, 15000);

  test('a poll with a deadline closes itself and everyone is told', async () => {
    await h.sleep(600);
    const heard = h.waitFor(mason, 'poll_closed', 5000);
    const { poll } = await h.call(doctor, 'create_poll', { title: 'Quick', options: ['a', 'b'], durationHours: 0.0002 }); // ~0.7s
    expect(poll.closesAt).toBeTruthy();
    const closed = await heard;
    expect(closed.pollId).toBe(poll.pollId);
    expect(closed.isOpen).toBe(false);
  }, 15000);
});

describe('peer-verified contributions', () => {
  test('pending until enough OTHER members endorse; balance credited exactly once', async () => {
    const alice = await h.register(srv.base, 'alice_v', 'carpenters');
    const bob = await h.register(srv.base, 'bob_v', 'doctors');
    const carol = await h.register(srv.base, 'carol_v', 'masons');
    const sa = await srv.connect(alice.token);
    const sb = await srv.connect(bob.token);
    const sc = await srv.connect(carol.token);

    const before = (await h.call(sa, 'sync')).stats.nationBalance;
    const { entry } = await h.call(sa, 'submit_contribution', { amount: 40, description: 'Built a bench' });
    expect(entry.status).toBe('pending');

    // Pending contributions do not count towards the Nation Balance.
    expect((await h.call(sa, 'sync')).stats.nationBalance).toBe(before);

    // No self-endorsement.
    expect(await h.call(sa, 'endorse_contribution', { entryId: entry.id }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/your own/i) });

    const first = await h.call(sb, 'endorse_contribution', { entryId: entry.id });
    expect(first.entry).toMatchObject({ status: 'pending', endorsementCount: 1 });

    // No double endorsement.
    await h.sleep(520);
    expect(await h.call(sb, 'endorse_contribution', { entryId: entry.id }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/already endorsed/i) });

    const balanceEvt = h.waitFor(sa, 'nation_balance_updated');
    const second = await h.call(sc, 'endorse_contribution', { entryId: entry.id });
    expect(second.entry.status).toBe('verified');
    const evt = await balanceEvt;
    expect(evt.totalNationBalance).toBe(before + 40);
    expect(evt.byTrade.find((r) => r.trade === 'carpenters').total).toBe(40);

    // Verified entries cannot be endorsed again, so no double credit.
    await h.sleep(520);
    expect(await h.call(sb, 'endorse_contribution', { entryId: entry.id })).toMatchObject({ ok: false });

    const me = await h.getJson(srv.base, '/api/dashboard/me', alice.token);
    expect(me.body.member.personal_balance).toBe(40);
  }, 20000);

  test('chat history and stats are available over REST too', async () => {
    const { token } = await h.register(srv.base, 'rest_reader', 'teachers');
    const stats = await h.getJson(srv.base, '/api/stats', token);
    expect(stats.status).toBe(200);
    expect(stats.body).toHaveProperty('byTrade');
    expect((await h.getJson(srv.base, '/api/polls', token)).status).toBe(200);
    expect((await h.getJson(srv.base, '/api/chat/guild', token)).status).toBe(200);
    expect((await h.getJson(srv.base, '/api/chat/bogus', token)).status).toBe(400);
    expect((await h.getJson(srv.base, '/api/stats')).status).toBe(401);
  });
});

describe('chat and presence', () => {
  test('guild messages stay in the guild; community messages reach everyone; history persists', async () => {
    const d1 = await h.register(srv.base, 'chat_dr1', 'doctors');
    const d2 = await h.register(srv.base, 'chat_dr2', 'doctors');
    const m1 = await h.register(srv.base, 'chat_mason', 'masons');
    const sd1 = await srv.connect(d1.token);
    const sd2 = await srv.connect(d2.token);
    const sm = await srv.connect(m1.token);

    const silent = h.expectSilence(sm, 'chat_message');
    const heard = h.waitFor(sd2, 'chat_message');
    await h.call(sd1, 'send_message', { channel: 'guild', text: 'doctors only <b>hi</b>' });
    expect((await heard).text).toBe('doctors only <b>hi</b>'); // stored as plain text, escaped by the client
    await silent;

    await h.sleep(520);
    const everyone = h.waitFor(sm, 'chat_message');
    await h.call(sd1, 'send_message', { channel: 'community', text: 'hello all' });
    expect((await everyone).channel).toBe('community');

    const sync = await h.call(sd2, 'sync');
    expect(sync.chat.guild.map((m) => m.text)).toContain('doctors only <b>hi</b>');
    expect(sync.chat.community.map((m) => m.text)).toContain('hello all');
    const masonSync = await h.call(sm, 'sync');
    expect(masonSync.chat.guild.map((m) => m.text)).not.toContain('doctors only <b>hi</b>');

    await h.sleep(520);
    expect(await h.call(sd1, 'send_message', { channel: 'guild', text: 'x'.repeat(501) }))
      .toMatchObject({ ok: false });
  }, 20000);

  test('presence reports unique online members per guild', async () => {
    const a = await h.register(srv.base, 'pres_a', 'teachers');
    const s1 = await srv.connect(a.token);
    const s2 = await srv.connect(a.token); // same member, second tab
    const { presence } = await h.call(s1, 'sync');
    expect(presence.byTrade.teachers).toBe(1);
    expect(s2.connected).toBe(true);
  });
});

describe('socket rate limiting', () => {
  test('a client that floods events is throttled, others are unaffected', async () => {
    const flood = await srv.connect((await h.register(srv.base, 'flooder', 'labors')).token);
    const calm = await srv.connect((await h.register(srv.base, 'calm_one', 'labors')).token);

    const results = await Promise.all(Array.from({ length: 30 }, () => h.call(flood, 'sync')));
    const throttled = results.filter((r) => !r.ok && /too quickly/i.test(r.error));
    expect(throttled.length).toBeGreaterThanOrEqual(15);
    expect(results.filter((r) => r.ok).length).toBeLessThanOrEqual(12);

    expect((await h.call(calm, 'sync')).ok).toBe(true);
  }, 20000);
});
