// Unified user + org store for auth and multi-tenancy. Uses MongoDB (the User /
// Org models) when a database is connected, and falls back to an in-process store
// otherwise — so sign-in works even when the local DB can't start (it just won't
// persist across restarts).
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { Org, newInviteCode } from '../models/Org.js';

const mem = new Map(); // email -> in-memory user
const memOrgs = new Map(); // orgId -> { id, name, inviteCode }
let seq = 1;
let orgSeq = 1;
const dbUp = () => mongoose.connection.readyState === 1;

function memUser(fields) {
  return {
    ...fields,
    verifyPassword(plain) { return bcrypt.compare(plain, this.passwordHash); },
    toSafeJSON() {
      return { id: this.id, email: this.email, name: this.name, company: this.company, orgId: this.orgId, role: this.role, createdAt: this.createdAt };
    },
    async save() { /* no-op for the memory fallback */ },
  };
}

export const orgStore = {
  async create({ name }) {
    if (dbUp()) return Org.create({ name: name || 'My team' });
    const org = { id: `org-${orgSeq++}`, name: name || 'My team', inviteCode: newInviteCode(), createdAt: new Date(), toSafeJSON() { return { id: this.id, name: this.name, inviteCode: this.inviteCode }; } };
    memOrgs.set(org.id, org);
    return org;
  },
  async get(id) {
    if (dbUp()) return mongoose.isValidObjectId(id) ? Org.findById(id) : null;
    return memOrgs.get(id) || null;
  },
  async findByInvite(code) {
    if (!code) return null;
    if (dbUp()) return Org.findOne({ inviteCode: code });
    for (const o of memOrgs.values()) if (o.inviteCode === code) return o;
    return null;
  },
  async rotateInvite(id) {
    const code = newInviteCode();
    if (dbUp()) return Org.findByIdAndUpdate(id, { inviteCode: code }, { new: true });
    const o = memOrgs.get(id);
    if (o) o.inviteCode = code;
    return o;
  },
};

export const userStore = {
  usingDb: dbUp,

  async findByEmail(email) {
    if (dbUp()) return User.findOne({ email });
    return mem.get(email) || null;
  },

  async findById(id) {
    if (dbUp()) {
      // A token minted while on the memory fallback carries a non-ObjectId id
      // ("1", "2", …). Guard so findById returns null (→ clean 401) instead of
      // throwing a CastError (→ 500) after the app switches to MongoDB.
      if (!mongoose.isValidObjectId(id)) return null;
      return User.findById(id);
    }
    for (const u of mem.values()) if (u.id === String(id)) return u;
    return null;
  },

  async create({ email, password, name = '', company = '', orgId, role = 'recruiter' }) {
    const passwordHash = await bcrypt.hash(password, 10);
    const orgIdStr = orgId != null ? String(orgId) : orgId;
    if (dbUp()) return User.create({ email, passwordHash, name, company, orgId: orgIdStr, role, lastLoginAt: new Date() });
    const u = memUser({ id: String(seq++), email, passwordHash, name, company, orgId: orgIdStr, role, createdAt: new Date(), lastLoginAt: new Date() });
    mem.set(email, u);
    return u;
  },
};

// Always ensure there's at least one working login, so the app is never locked out.
// The seed admin gets its own org so demo data stays isolated like any tenant.
export async function seedDefaultUser() {
  const email = String(process.env.SEED_ADMIN_EMAIL || 'admin@incsource.com').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'incsource123';
  try {
    const existing = await userStore.findByEmail(email);
    if (existing) {
      console.log(`👤 Login available → ${email}`);
      // Legacy admin created before multi-tenancy → give it an org so it's scoped
      // like everyone else (and so the backfill has a target).
      if (!existing.orgId) {
        const org = await orgStore.create({ name: 'InCruiter (demo)' });
        existing.orgId = String(org.id || org._id);
        existing.role = existing.role || 'admin';
        await existing.save();
      }
      return existing.orgId || null;
    }
    const org = await orgStore.create({ name: 'InCruiter (demo)' });
    const orgId = String(org.id || org._id);
    await userStore.create({ email, password, name: 'Demo Recruiter', company: 'InCruiter', orgId, role: 'admin' });
    console.log(`👤 Seeded login → ${email}  /  ${password}${userStore.usingDb() ? '' : '  (in-memory — not persisted)'}`);
    return orgId;
  } catch (e) {
    console.warn('Seed user failed:', e.message);
    return null;
  }
}
