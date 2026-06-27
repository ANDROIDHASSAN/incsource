import { Router } from 'express';
import { asyncHandler, rateLimit } from '../middleware/index.js';
import { agentTurn } from '../services/agent.js';

export const agentRouter = Router();

// One conversational turn. Returns the assistant's reply, the structured brief so
// far, and whether it's ready to run. Execution itself goes through the normal
// sourcing/email endpoints, so all org-scoping, rate-limits and spend caps apply.
agentRouter.post('/chat', rateLimit({ windowMs: 60_000, max: 40 }), asyncHandler(async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  if (!messages.length) return res.status(400).json({ error: 'messages required' });
  const turn = await agentTurn(messages);
  res.json(turn);
}));
