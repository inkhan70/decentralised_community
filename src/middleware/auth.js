const jwt = require('jsonwebtoken');
const config = require('../config/env');

// Pin the algorithm so a token can never be accepted under a weaker/unexpected one.
const VERIFY_OPTIONS = { algorithms: ['HS256'] };

/** Verifies a raw JWT string; returns the decoded payload or throws. */
function verifyJwt(token) {
  return jwt.verify(token, config.JWT_SECRET, VERIFY_OPTIONS);
}

/** Express middleware: requires a valid `Authorization: Bearer <token>` header. */
function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ error: 'Access token missing' });

  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Access token missing' });
  }

  jwt.verify(token, config.JWT_SECRET, VERIFY_OPTIONS, (err, decoded) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = decoded;
    next();
  });
}

module.exports = verifyToken;
module.exports.verifyJwt = verifyJwt;
