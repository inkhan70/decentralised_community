const { mongoose } = require('../db');

const communityUserSchema = new mongoose.Schema({
  firebaseUid: { type: String, required: true, unique: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  emailVerified: { type: Boolean, default: false },
  fullname: { type: String, required: true, trim: true, maxlength: 100 },
  photoURL: { type: String, default: '' },
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityCategory', default: null },
  role: { type: String, enum: ['member', 'admin', 'super_admin'], default: 'member', index: true },
  status: { type: String, enum: ['active', 'suspended'], default: 'active' },
  onboardingComplete: { type: Boolean, default: false },
  lastLoginAt: { type: Date, default: Date.now }
}, { timestamps: true });
communityUserSchema.index({ role: 1 }, { unique: true, partialFilterExpression: { role: 'super_admin' } });

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
  description: { type: String, default: '', maxlength: 500 },
  enabled: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 100 },
  archivedAt: { type: Date, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityIdentity', default: null }
}, { timestamps: true });

const auditSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, required: true },
  actorEmail: { type: String, required: true },
  action: { type: String, required: true },
  targetType: { type: String, required: true },
  targetId: { type: String, default: '' },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  ip: { type: String, default: '' }
}, { timestamps: true });

const CommunityIdentity = mongoose.models.CommunityIdentity || mongoose.model('CommunityIdentity', communityUserSchema);
const CommunityCategory = mongoose.models.CommunityCategory || mongoose.model('CommunityCategory', categorySchema);
const AdminAudit = mongoose.models.AdminAudit || mongoose.model('AdminAudit', auditSchema);
module.exports = { CommunityIdentity, CommunityCategory, AdminAudit };
