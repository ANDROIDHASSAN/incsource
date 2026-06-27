// Unified user store for auth. Uses MongoDB (the User model) when a database is
// connected, and falls back to an in-process store otherwise — so sign-in works
// even when the local DB can't start (it just won't persist across restarts).
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';

const mem = new Map(); // email -> in-memory user
let seq = 1;
const dbUp = () => mongoose.connection.readyState === 1;

function memUser(fields) {
  return {
    ...fields,
    verifyPassword(plain) { return bcrypt.compare(plain, this.passwordHash); },
    toSafeJSON() {
      return { id: this.id, email: this.email, name: this.name, company: this.company, role: this.role, createdAt: this.createdAt };
    },
    async save() { /* no-op for the memory fallback */ },
  };
}

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

  async create({ email, password, name = '', company = '', role = 'recruiter' }) {
    const passwordHash = await bcrypt.hash(password, 10);
    if (dbUp()) return User.create({ email, passwordHash, name, company, role, lastLoginAt: new Date() });
    const u = memUser({ id: String(seq++), email, passwordHash, name, company, role, createdAt: new Date(), lastLoginAt: new Date() });
    mem.set(email, u);
    return u;
  },
};

// Always ensure there's at least one working login, so the app is never locked out.
export async function seedDefaultUser() {
  const email = String(process.env.SEED_ADMIN_EMAIL || 'admin@incsource.com').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'incsource123';
  try {
    const existing = await userStore.findByEmail(email);
    if (existing) { console.log(`👤 Login available → ${email}`); return; }
    await userStore.create({ email, password, name: 'Demo Recruiter', company: 'InCruiter', role: 'admin' });
    console.log(`👤 Seeded login → ${email}  /  ${password}${userStore.usingDb() ? '' : '  (in-memory — not persisted)'}`);
  } catch (e) {
    console.warn('Seed user failed:', e.message);
  }
}
