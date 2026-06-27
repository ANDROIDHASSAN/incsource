import { Router } from 'express';
import { userStore, orgStore } from '../services/userStore.js';
import { signToken } from '../services/auth.js';
import { asyncHandler, requireAuth, rateLimit } from '../middleware/index.js';

export const authRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/auth/register — create an account and return a token.
authRouter.post(
  '/register',
  rateLimit({ windowMs: 60_000, max: 10 }),
  asyncHandler(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim();
    const company = String(req.body?.company || '').trim();

    const inviteCode = String(req.body?.inviteCode || '').trim();

    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid work email.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const exists = await userStore.findByEmail(email);
    if (exists) return res.status(409).json({ error: 'An account with that email already exists.' });

    // Join an existing team with a valid invite (as a recruiter), or start a fresh
    // org (as its admin). Every account therefore belongs to exactly one tenant.
    let org;
    let role;
    if (inviteCode) {
      org = await orgStore.findByInvite(inviteCode);
      if (!org) return res.status(400).json({ error: 'That invite code is invalid or has been rotated.' });
      role = 'recruiter';
    } else {
      org = await orgStore.create({ name: company || `${name || email.split('@')[0]}'s team` });
      role = 'admin';
    }

    const user = await userStore.create({ email, password, name, company, orgId: String(org.id || org._id), role });
    res.status(201).json({ token: signToken(user), user: user.toSafeJSON() });
  })
);

// POST /api/auth/login — verify credentials and return a token.
authRouter.post(
  '/login',
  rateLimit({ windowMs: 60_000, max: 20 }),
  asyncHandler(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    const user = await userStore.findByEmail(email);
    if (!user || !(await user.verifyPassword(password))) {
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }
    user.lastLoginAt = new Date();
    await user.save();
    res.json({ token: signToken(user), user: user.toSafeJSON() });
  })
);

// GET /api/auth/me — current user from the Bearer token.
authRouter.get(
  '/me',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const user = await userStore.findById(req.user.sub);
    if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
    res.json({ user: user.toSafeJSON() });
  })
);

export default authRouter;
