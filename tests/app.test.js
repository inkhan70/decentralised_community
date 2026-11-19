process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-suite-secret-value-that-is-long-enough';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/test-does-not-need-to-connect';

const request = require('supertest');
const { createApp } = require('../src/app');

const app = createApp();

describe('GET /health', () => {
  test('responds 200 with a status payload even without a live DB connection', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('db');
  });
});

describe('POST /api/auth/register - validation', () => {
  test('rejects a request missing required fields', async () => {
    const res = await request(app).post('/api/auth/register').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('rejects an invalid trade before touching the database', async () => {
    const res = await request(app).post('/api/auth/register').send({
      username: 'validuser',
      password: 'longenoughpassword',
      fullname: 'Valid User',
      trade: 'astronaut'
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid trade/i);
  });

  test('rejects a password that is too short', async () => {
    const res = await request(app).post('/api/auth/register').send({
      username: 'validuser',
      password: 'short',
      fullname: 'Valid User',
      trade: 'developers'
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password/i);
  });
});

describe('POST /api/auth/login - validation', () => {
  test('rejects a request missing credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /api/dashboard/me - auth required', () => {
  test('rejects requests with no token', async () => {
    const res = await request(app).get('/api/dashboard/me');
    expect(res.status).toBe(401);
  });
});

describe('unknown route', () => {
  test('returns 404 for a path that does not exist', async () => {
    const res = await request(app).get('/this-does-not-exist');
    expect(res.status).toBe(404);
  });
});
