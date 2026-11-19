const fs = require('fs');
const os = require('os');
const path = require('path');
const { io: ioClient } = require('socket.io-client');

/** Must be called BEFORE anything from src/ is required (config reads env once). */
function setEnv(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'community-test-'));
  Object.assign(process.env, {
    NODE_ENV: 'test',
    JWT_SECRET: 'test-suite-secret-value-that-is-long-enough',
    STORAGE_DRIVER: 'local',
    LOCAL_DB_PATH: path.join(dir, 'db.json'),
    HOST: '127.0.0.1',
    PORT: '0',
    BCRYPT_SALT_ROUNDS: '4',
    RATE_LIMIT_MAX: '1000',
    POLL_SWEEP_INTERVAL_MS: '1000',
    ...extra
  });
  return dir;
}

async function startServer() {
  const { start } = require('../../server');
  const ctx = await start();
  if (!ctx.server.listening) await new Promise((r) => ctx.server.once('listening', r));
  const base = `http://127.0.0.1:${ctx.server.address().port}`;
  const sockets = new Set();

  return {
    ...ctx,
    base,
    /** Connects an authenticated socket; resolves once connected, rejects on handshake failure. */
    connect(token) {
      return new Promise((resolve, reject) => {
        const s = ioClient(base, { auth: { token }, transports: ['websocket'], reconnection: false });
        sockets.add(s);
        s.once('connect', () => resolve(s));
        s.once('connect_error', (err) => { s.close(); reject(err); });
      });
    },
    async stop() {
      for (const s of sockets) s.close();
      ctx.sockets.stop();
      await new Promise((r) => ctx.io.close(() => r()));
      await require('../../src/storage').disconnect();
      fs.rmSync(path.dirname(process.env.LOCAL_DB_PATH), { recursive: true, force: true });
    }
  };
}

async function postJson(base, url, body, headers = {}) {
  const res = await fetch(base + url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}

async function getJson(base, url, token) {
  const res = await fetch(base + url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function register(base, username, trade) {
  const r = await postJson(base, '/api/auth/register', {
    username, password: 'correct-horse-battery', fullname: `${username} Name`, trade
  });
  if (r.status !== 201) throw new Error(`register ${username} failed: ${r.status} ${JSON.stringify(r.body)}`);
  return { token: r.body.token, user: r.body.user };
}

/** Emits with an ack and resolves with the server's reply. */
const call = (socket, event, payload) =>
  new Promise((resolve) => socket.emit(event, payload, (res) => resolve(res)));

/** Resolves with the next `event` payload, or rejects after `ms`. */
const waitFor = (socket, event, ms = 2500) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), ms);
    socket.once(event, (data) => { clearTimeout(t); resolve(data); });
  });

/** Asserts an event does NOT arrive within `ms`. */
const expectSilence = (socket, event, ms = 300) =>
  new Promise((resolve, reject) => {
    const handler = () => reject(new Error(`unexpected "${event}" event`));
    socket.once(event, handler);
    setTimeout(() => { socket.off(event, handler); resolve(); }, ms);
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { setEnv, startServer, postJson, getJson, register, call, waitFor, expectSilence, sleep };
