process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-suite-secret-value-that-is-long-enough';
process.env.STORAGE_DRIVER = 'mongo';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/test-does-not-need-to-connect';
process.env.ALLOWED_ORIGINS = 'https://decentralised-community.vercel.app';

jest.mock('../src/storage', () => ({
  driverName: 'mongo',
  isReady: () => false,
  connect: jest.fn().mockRejectedValue(Object.assign(new Error('bad auth : Authentication failed.'), { code: 18 })),
  users: {}, ledger: {}, polls: {}, votes: {}, messages: {}
}));

const { handler } = require('../netlify/functions/api');
const { classifyConnectionError } = require('../src/db');

const event = (extra) => ({
  httpMethod: 'POST',
  path: '/.netlify/functions/api/auth/login',
  headers: { origin: 'https://decentralised-community.vercel.app', 'content-type': 'application/json' },
  body: '{}',
  ...extra
});

describe('netlify handler when MongoDB is unavailable', () => {
  test('503 still carries CORS headers so the browser can read the real error', async () => {
    const res = await handler(event(), {});
    expect(res.statusCode).toBe(503);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://decentralised-community.vercel.app');
    const body = JSON.parse(res.body);
    expect(body.reason).toBe('auth_failed');
    expect(body.error).toMatch(/Database is temporarily unavailable/);
  });

  test('CORS preflight is answered without touching the database', async () => {
    const storage = require('../src/storage');
    storage.connect.mockClear();
    const res = await handler(event({ httpMethod: 'OPTIONS', headers: { origin: 'https://decentralised-community.vercel.app', 'access-control-request-method': 'POST' } }), {});
    expect(res.statusCode).toBe(204);
    expect(storage.connect).not.toHaveBeenCalled();
  });
});

describe('classifyConnectionError', () => {
  test('recognises common Atlas failures', () => {
    expect(classifyConnectionError(new Error('Server selection timed out after 8000 ms')).reason).toBe('network_or_allowlist');
    expect(classifyConnectionError(new Error('querySrv ENOTFOUND _mongodb._tcp.x')).reason).toBe('dns');
    expect(classifyConnectionError(Object.assign(new Error('x'), { code: 'MONGO_URI_PLACEHOLDER' })).reason).toBe('uri_placeholder');
  });
});
