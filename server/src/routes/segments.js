import { Router } from 'express';
import { store } from '../store/index.js';
import { asyncHandler, requireRole } from '../middleware/index.js';

export const segmentsRouter = Router();
const canWrite = requireRole('recruiter');

segmentsRouter.get('/', asyncHandler(async (req, res) => {
  res.json({ segments: await store.listSegments(req.user.orgId) });
}));

segmentsRouter.post('/', canWrite, asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'Name required' });
  const filters = req.body?.filters && typeof req.body.filters === 'object' ? req.body.filters : {};
  res.status(201).json(await store.saveSegment(name, filters, req.user.orgId));
}));

segmentsRouter.delete('/:id', canWrite, asyncHandler(async (req, res) => {
  res.json({ deleted: await store.deleteSegment(req.params.id, req.user.orgId) });
}));
