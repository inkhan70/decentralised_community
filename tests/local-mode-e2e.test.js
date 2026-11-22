const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-suite-secret-value-that-is-long-enough';
process.env.STORAGE_DRIVER = 'local';
process.env.LOCAL_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'community-e2e-')), 'db.json');

const request = require('supertest');
const { createApp } = require('../src/app');
const storage = require('../src/storage');

const app = createApp();

beforeAll(async () => {
  await storage.connect();
});

afterAll(async () => {
  await storage.disconnect();
  fs.rmSync(path.dirname(process.env.LOCAL_DB_PATH), { recursive: true, force: true });
});

describe('End-to-end flow on the local storage driver', () => {
  let token;

  test('registers a new member', async () => {
    const res = await request(app).post('/api/auth/register').send({
      username: 'RiverGuild',
      password: 'correct-horse-battery',
      fullname: 'River Guild',
      trade: 'carpenters'
    });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user.username).toBe('riverguild'); // stored lowercase
  });

  test('rejects a duplicate registration', async () => {
    const res = await request(app).post('/api/auth/register').send({
      username: 'riverguild',
      password: 'another-password',
      fullname: 'Someone Else',
      trade: 'masons'
    });
    expect(res.status).toBe(409);
  });

  test('logs in with the correct password', async () => {
    const res = await request(app).post('/api/auth/login').send({
      username: 'riverguild',
      password: 'correct-horse-battery'
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    token = res.body.token;
  });

  test('rejects login with the wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({
      username: 'riverguild',
      password: 'wrong-password'
    });
    expect(res.status).toBe(401);
  });

  test('fetches the authenticated dashboard', async () => {
    const res = await request(app).get('/api/dashboard/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.member.username).toBe('riverguild');
    expect(res.body.member.password_hash).toBeUndefined();
    expect(res.body).toHaveProperty('nationBalance');
  });

  test('a contribution recorded directly in storage shows up in ledger history', async () => {
    const user = await storage.users.findByUsername('riverguild');
    await storage.ledger.create({ user_id: user.id, amount: 75, trade: 'carpenters', description: 'Repaired the dock' });

    const res = await request(app).get('/api/ledger/history').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].description).toBe('Repaired the dock');
    expect(res.body[0].user_id).toMatchObject({ username: 'riverguild' });
  });

  test('/health reports the active storage driver', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.storageDriver).toBe('local');
    expect(res.body.db).toBe('connected');
  });
});
