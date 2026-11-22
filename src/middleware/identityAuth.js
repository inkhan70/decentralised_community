const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { CommunityIdentity } = require('../models/identity');
async function identityAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Sign in required.' });
    const claims = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
    const user = await CommunityIdentity.findById(claims.identityId || claims.id);
    if (!user || user.status !== 'active') return res.status(401).json({ error: 'Account unavailable.' });
    req.identity = user;
    next();
  } catch (_) { return res.status(401).json({ error: 'Invalid or expired session.' }); }
}
function requireAdmin(req, res, next) {
  if (!req.identity || !['admin', 'super_admin'].includes(req.identity.role)) return res.status(403).json({ error: 'Administrator permission required.' });
  next();
}
function requireSuperAdmin(req, res, next) {
  if (!req.identity || req.identity.role !== 'super_admin') return res.status(403).json({ error: 'Super administrator permission required.' });
  next();
}
module.exports = { identityAuth, requireAdmin, requireSuperAdmin };
