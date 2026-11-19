const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const admin = require('firebase-admin');
const config = require('../config/env');
const { CommunityIdentity, CommunityCategory } = require('../models/identity');
const { User } = require('../models');
const router = express.Router();

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
let firebaseApp;
function getFirebaseAdmin() {
  if (firebaseApp) return firebaseApp;
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured');
    const serviceAccount = JSON.parse(raw);
    firebaseApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } else firebaseApp = admin.app();
  return firebaseApp;
}
function issueSession(identity, legacyUser) {
  return jwt.sign({ id: legacyUser._id.toString(), identityId: identity._id.toString(), email: identity.email, role: identity.role }, config.JWT_SECRET, { algorithm: 'HS256', expiresIn: config.JWT_EXPIRES_IN });
}

router.post('/google', limiter, async (req, res) => {
  try {
    const idToken = req.body && req.body.idToken;
    if (typeof idToken !== 'string' || !idToken) return res.status(400).json({ error: 'Google ID token is required.' });
    const decoded = await getFirebaseAdmin().auth().verifyIdToken(idToken, true);
    if (!decoded.email || decoded.email_verified !== true) return res.status(403).json({ error: 'Use a Google account with a verified email address.' });
    const email = decoded.email.toLowerCase();
    let user = await CommunityIdentity.findOne({ firebaseUid: decoded.uid });
    if (!user) user = await CommunityIdentity.create({ firebaseUid: decoded.uid, email, emailVerified: true, fullname: decoded.name || email.split('@')[0], photoURL: decoded.picture || '' });
    else {
      user.email = email; user.emailVerified = true; user.fullname = decoded.name || user.fullname; user.photoURL = decoded.picture || user.photoURL; user.lastLoginAt = new Date();
    }
    // Bootstrap is restricted to one preconfigured, verified email. Never grant admin to an arbitrary first visitor.
    const bootstrapEmail = (process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
    if (bootstrapEmail && email === bootstrapEmail) await CommunityIdentity.init();
    if (bootstrapEmail && email === bootstrapEmail && user.role !== 'super_admin') {
      try {
        user.role = 'super_admin';
        await user.save();
      } catch (e) {
        if (e.code !== 11000) throw e;
        user = await CommunityIdentity.findOne({ firebaseUid: decoded.uid });
      }
    } else await user.save();
    if (user.status !== 'active') return res.status(403).json({ error: 'This account is suspended. Contact the community administrator.' });
    let legacyUser = await User.findOne({ firebaseUid: decoded.uid });
    if (!legacyUser) {
      const username = `g_${decoded.uid.slice(0, 20).toLowerCase()}`;
      legacyUser = await User.create({ firebaseUid: decoded.uid, email, username, fullname: user.fullname, trade: 'unassigned', password_hash: null, contact_number: '' });
    } else { legacyUser.email = email; legacyUser.fullname = user.fullname; await legacyUser.save(); }
    if (!(await CommunityCategory.estimatedDocumentCount())) {
      await CommunityCategory.insertMany([
        { name: 'Healthcare', slug: 'healthcare', description: 'Medical and health services', sortOrder: 10 },
        { name: 'Education', slug: 'education', description: 'Teachers, learners and education services', sortOrder: 20 },
        { name: 'Technology', slug: 'technology', description: 'Developers and technology professionals', sortOrder: 30 },
        { name: 'Skilled Trades', slug: 'skilled-trades', description: 'Technicians, builders and skilled workers', sortOrder: 40 },
        { name: 'Business & Commerce', slug: 'business-commerce', description: 'Business owners, producers and distributors', sortOrder: 50 },
        { name: 'Community Member', slug: 'community-member', description: 'General community participation', sortOrder: 60 }
      ], { ordered: false }).catch((e) => { if (e.code !== 11000) throw e; });
    }
    const categories = await CommunityCategory.find({ enabled: true, archivedAt: null }).sort({ sortOrder: 1, name: 1 }).select('name slug description');
    res.json({ token: issueSession(user, legacyUser), user: { id: legacyUser._id.toString(), identityId: user._id.toString(), email: user.email, fullname: user.fullname, photoURL: user.photoURL, role: user.role, categoryId: user.categoryId, onboardingComplete: user.onboardingComplete, trade: legacyUser.trade }, categories });
  } catch (err) {
    console.error('[auth/google]', err.message);
    res.status(401).json({ error: 'Google sign-in could not be verified. Check Firebase configuration and try again.' });
  }
});
module.exports = router;
