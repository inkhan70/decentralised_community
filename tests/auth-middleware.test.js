process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-suite-secret-value-that-is-long-enough';

const jwt = require('jsonwebtoken');
const verifyToken = require('../src/middleware/auth');
const config = require('../src/config/env');

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

describe('verifyToken middleware', () => {
  test('rejects requests with no Authorization header', () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = jest.fn();

    verifyToken(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects a malformed Authorization header', () => {
    const req = { headers: { authorization: 'Basic abc123' } };
    const res = mockRes();
    const next = jest.fn();

    verifyToken(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects an invalid or expired token', () => {
    const req = { headers: { authorization: 'Bearer not-a-real-token' } };
    const res = mockRes();
    const next = jest.fn();

    verifyToken(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('accepts a valid token and attaches the decoded payload to req.user', () => {
    const token = jwt.sign({ id: 'abc123', username: 'sam', trade: 'developers' }, config.JWT_SECRET, {
      expiresIn: '1h'
    });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    const next = jest.fn();

    verifyToken(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({ id: 'abc123', username: 'sam', trade: 'developers' });
  });
});
