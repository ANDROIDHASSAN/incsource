import mongoose from 'mongoose';
import crypto from 'crypto';

// An organisation (tenant). Every candidate, segment, sourcing run and template
// belongs to exactly one org, and users only ever see their own org's data.
// `inviteCode` lets an admin add teammates to the same org (shared talent pool).
export const newInviteCode = () => crypto.randomBytes(9).toString('base64url');

const orgSchema = new mongoose.Schema(
  {
    name: { type: String, default: 'My team' },
    inviteCode: { type: String, default: newInviteCode, index: true },
  },
  { timestamps: true }
);

orgSchema.methods.toSafeJSON = function toSafeJSON() {
  return { id: String(this._id), name: this.name, inviteCode: this.inviteCode, createdAt: this.createdAt };
};

export const Org = mongoose.models.Org || mongoose.model('Org', orgSchema);
