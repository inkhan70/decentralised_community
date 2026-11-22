const h = require('./helpers/harness');
h.setEnv({ RATE_LIMIT_MAX: '3', RATE_LIMIT_WINDOW_MS: '60000' });

let srv;
beforeAll(async () => { srv = await h.startServer(); });
afterAll(() => srv.stop());

describe('login rate limiting', () => {
  test('successful logins never lock a member out, but repeated failures do', async () => {
    const bcrypt = require('bcrypt');
    await require('../src/storage').users.create({
      username: 'limiter', password_hash: await bcrypt.hash('correct-horse-battery', 4), fullname: 'L', trade: 'masons'
    });

    for (let i = 0; i < 6; i++) {
      const ok = await h.postJson(srv.base, '/api/auth/login', { username: 'limiter', password: 'correct-horse-battery' });
      expect(ok.status).toBe(200); // 6 successes > RATE_LIMIT_MAX of 3
    }
    const fails = [];
    for (let i = 0; i < 5; i++) {
      fails.push((await h.postJson(srv.base, '/api/auth/login', { username: 'limiter', password: 'wrong-password-1' })).status);
    }
    expect(fails.slice(0, 3)).toEqual([401, 401, 401]);
    expect(fails.slice(3)).toEqual([429, 429]);
  });
});
