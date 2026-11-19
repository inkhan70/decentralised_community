const express = require('express');
const mongoose = require('mongoose');
const { CommunityIdentity, CommunityCategory, AdminAudit } = require('../models/identity');
const { User } = require('../models');
const { identityAuth, requireAdmin, requireSuperAdmin } = require('../middleware/identityAuth');
const router = express.Router();
router.use(identityAuth);
const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
async function audit(req, action, targetType, targetId, details = {}) {
  await AdminAudit.create({ actorId: req.identity._id, actorEmail: req.identity.email, action, targetType, targetId: String(targetId || ''), details, ip: req.ip });
}
router.get('/categories', async (req, res) => {
  const filter = req.identity.role === 'member' ? { enabled: true, archivedAt: null } : {};
  const categories = await CommunityCategory.find(filter).sort({ sortOrder: 1, name: 1 }).lean();
  res.json({ categories });
});
router.post('/onboarding/category', async (req, res) => {
  const { categoryId } = req.body || {};
  if (!mongoose.isValidObjectId(categoryId)) return res.status(400).json({ error: 'Select a valid category.' });
  const category = await CommunityCategory.findOne({ _id: categoryId, enabled: true, archivedAt: null });
  if (!category) return res.status(404).json({ error: 'Category is not available.' });
  req.identity.categoryId = category._id; req.identity.onboardingComplete = true; await req.identity.save();
  await User.findOneAndUpdate({ firebaseUid: req.identity.firebaseUid }, { $set: { trade: category.slug } });
  res.json({ success: true, category: { id: category._id, name: category.name, slug: category.slug }, onboardingComplete: true });
});
router.post('/admin/categories', requireAdmin, async (req, res) => {
  const { name, description = '', sortOrder = 100 } = req.body || {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) return res.status(400).json({ error: 'Category name must be 2–80 characters.' });
  const slug = slugify(name);
  if (!slug) return res.status(400).json({ error: 'Category name must contain letters or numbers.' });
  try {
    const category = await CommunityCategory.create({ name: name.trim(), slug, description: String(description).slice(0, 500), sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 100, createdBy: req.identity._id });
    await audit(req, 'category.create', 'category', category._id, { name: category.name, slug });
    res.status(201).json({ category });
  } catch (e) { if (e.code === 11000) return res.status(409).json({ error: 'A category with this name already exists.' }); throw e; }
});
router.patch('/admin/categories/:id', requireAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid category ID.' });
  const updates = {};
  if (typeof req.body.name === 'string' && req.body.name.trim().length >= 2 && req.body.name.trim().length <= 80) { updates.name = req.body.name.trim(); updates.slug = slugify(updates.name); }
  if (typeof req.body.description === 'string') updates.description = req.body.description.slice(0, 500);
  if (typeof req.body.enabled === 'boolean') updates.enabled = req.body.enabled;
  if (Number.isFinite(Number(req.body.sortOrder))) updates.sortOrder = Number(req.body.sortOrder);
  const category = await CommunityCategory.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true, runValidators: true });
  if (!category) return res.status(404).json({ error: 'Category not found.' });
  await audit(req, 'category.update', 'category', category._id, updates);
  res.json({ category });
});
router.delete('/admin/categories/:id', requireAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid category ID.' });
  const category = await CommunityCategory.findById(req.params.id);
  if (!category) return res.status(404).json({ error: 'Category not found.' });
  const members = await CommunityIdentity.countDocuments({ categoryId: category._id, status: 'active' });
  if (members) return res.status(409).json({ error: `This category has ${members} active member(s). Reassign them before removing it.` });
  category.enabled = false; category.archivedAt = new Date(); await category.save();
  await audit(req, 'category.archive', 'category', category._id, { name: category.name });
  res.json({ success: true, message: 'Category archived. Historical records are preserved.' });
});
router.get('/admin/overview', requireAdmin, async (req, res) => {
  const [members, active, suspended, categories, admins] = await Promise.all([
    CommunityIdentity.countDocuments(), CommunityIdentity.countDocuments({ status: 'active' }), CommunityIdentity.countDocuments({ status: 'suspended' }), CommunityCategory.countDocuments({ archivedAt: null }), CommunityIdentity.countDocuments({ role: { $in: ['admin', 'super_admin'] } })
  ]);
  res.json({ members, active, suspended, categories, admins });
});
router.get('/admin/members', requireAdmin, async (req, res) => {
  const members = await CommunityIdentity.find().select('email fullname role status categoryId onboardingComplete createdAt').populate('categoryId', 'name').sort({ createdAt: -1 }).limit(500).lean();
  res.json({ members });
});
router.patch('/admin/members/:id', requireSuperAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid member ID.' });
  const target = await CommunityIdentity.findById(req.params.id);
  if (!target) return res.status(404).json({ error: 'Member not found.' });
  if (target.role === 'super_admin') return res.status(403).json({ error: 'The Super Admin account is protected.' });
  const updates = {};
  if (['member', 'admin'].includes(req.body.role)) updates.role = req.body.role;
  if (['active', 'suspended'].includes(req.body.status)) updates.status = req.body.status;
  Object.assign(target, updates); await target.save();
  await audit(req, 'member.update', 'member', target._id, updates);
  res.json({ member: { id: target._id, email: target.email, role: target.role, status: target.status } });
});
router.get('/admin/audit', requireAdmin, async (req, res) => {
  const logs = await AdminAudit.find().sort({ createdAt: -1 }).limit(200).lean();
  res.json({ logs });
});
module.exports = router;
