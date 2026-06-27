import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true },
    name: { type: String, default: '' },
    company: { type: String, default: '' },
    // Tenant the user belongs to, and what they can do within it.
    orgId: { type: String, index: true },
    role: { type: String, enum: ['viewer', 'recruiter', 'admin'], default: 'recruiter' },
    lastLoginAt: Date,
  },
  { timestamps: true }
);

// Never leak the hash to clients.
userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: String(this._id),
    email: this.email,
    name: this.name,
    company: this.company,
    orgId: this.orgId,
    role: this.role,
    createdAt: this.createdAt,
  };
};

userSchema.methods.verifyPassword = function verifyPassword(plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.statics.hashPassword = function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
};

export const User = mongoose.models.User || mongoose.model('User', userSchema);
