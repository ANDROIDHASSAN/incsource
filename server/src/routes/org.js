import { Router } from 'express';
import { orgStore } from '../services/userStore.js';
import { asyncHandler, requireRole } from '../middleware/index.js';
import { audit } from '../services/audit.js';

export const orgRouter = Router();

// Current team + its invite code. Members register with this code to join the same
// shared talent pool (vs. starting their own org). The invite is shown to admins;
// recruiters/viewers see the team name only.
orgRouter.get('/', asyncHandler(async (req, res) => {
  const org = await orgStore.get(req.user.orgId);
  if (!org) return res.json({ id: req.user.orgId, name: 'My team', role: req.user.role });
  const safe = org.toSafeJSON ? org.toSafeJSON() : org;
  const isAdmin = req.user.role === 'admin';
  res.json({ id: safe.id || String(org._id), name: safe.name, role: req.user.role, inviteCode: isAdmin ? safe.inviteCode : undefined });
}));

// Rotate the invite code (admin only) — instantly invalidates old invites.
orgRouter.post('/rotate-invite', requireRole('admin'), asyncHandler(async (req, res) => {
  const org = await orgStore.rotateInvite(req.user.orgId);
  audit(req, 'org.rotateInvite', {});
  const safe = org?.toSafeJSON ? org.toSafeJSON() : org;
  res.json({ inviteCode: safe?.inviteCode });
}));
