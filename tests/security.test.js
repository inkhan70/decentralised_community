const h = require('./helpers/harness');
h.setEnv();

let srv;
beforeAll(async () => { srv = await h.startServer(); });
afterAll(() => srv.stop());

describe('bundled frontend is actually usable under the CSP', () => {
  test('CSP allows same-origin scripts only and does not force https upgrades on LAN/http use', async () => {
    const res = await fetch(`${srv.base}/`);
    const csp = res.headers.get('content-security-policy');
    expect(csp).toMatch(/script-src 'self'(;|$)/);
    expect(csp).not.toMatch(/upgrade-insecure-requests/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).not.toMatch(/unsafe-inline.*script-src|script-src[^;]*unsafe/);
  });

  test('index.html has no inline script, no inline handlers and no third-party hosts', async () => {
    const html = await (await fetch(`${srv.base}/`)).text();
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);           // onclick= etc. (blocked by script-src-attr)
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/i); // every <script> has a src
    expect(html).not.toMatch(/https?:\/\//i);             // nothing fetched from another origin
  });

  test('every asset the page references is served', async () => {
    for (const p of ['/app.js', '/styles.css', '/socket.io/socket.io.js']) {
      const res = await fetch(srv.base + p);
      expect([p, res.status]).toEqual([p, 200]);
    }
  });
});

describe('input hardening', () => {
  test('non-string credentials are a 400, not a 500', async () => {
    const r = await h.postJson(srv.base, '/api/auth/login', { username: 'x', password: { a: 1 } });
    expect(r.status).toBe(400);
  });

  test('registration rejects object/oversized names and junk contact numbers', async () => {
    const base = { username: 'valid_user', password: 'correct-horse-battery', trade: 'masons' };
    expect((await h.postJson(srv.base, '/api/auth/register', { ...base, fullname: { x: 1 } })).status).toBe(400);
    expect((await h.postJson(srv.base, '/api/auth/register', { ...base, fullname: 'x'.repeat(101) })).status).toBe(400);
    expect((await h.postJson(srv.base, '/api/auth/register', { ...base, fullname: 'Ok', contact_number: '<img src=x>' })).status).toBe(400);
  });

  test('malformed JSON is a 400 with a clear message', async () => {
    const r = await h.postJson(srv.base, '/api/auth/login', '{"username": ');
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/malformed/i);
  });

  test('a token signed with alg "none" is rejected by the REST API', async () => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const forged = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ id: 'a'.repeat(24) })}.`;
    expect((await h.getJson(srv.base, '/api/dashboard/me', forged)).status).toBe(403);
  });
});
