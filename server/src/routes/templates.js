import { Router } from 'express';
import { store } from '../store/index.js';
import { asyncHandler, requireRole } from '../middleware/index.js';
import { TEMPLATES } from '../services/outreach.js';

export const templatesRouter = Router();
const canWrite = requireRole('recruiter');

// All templates = built-in (read-only) + this org's custom (editable).
templatesRouter.get('/', asyncHandler(async (req, res) => {
  const custom = await store.listTemplates(req.user.orgId);
  res.json({ templates: [...TEMPLATES.map((t) => ({ ...t, custom: false })), ...custom] });
}));

templatesRouter.post('/', canWrite, asyncHandler(async (req, res) => {
  const { name, subject, body } = clean(req.body);
  if (!name || !subject || !body) return res.status(400).json({ error: 'name, subject and body are required' });
  res.status(201).json(await store.saveTemplate({ name, subject, body, orgId: req.user.orgId }));
}));

templatesRouter.patch('/:id', canWrite, asyncHandler(async (req, res) => {
  if (TEMPLATES.some((t) => t.id === req.params.id)) return res.status(400).json({ error: 'Built-in templates cannot be edited' });
  const updated = await store.updateTemplate(req.params.id, clean(req.body), req.user.orgId);
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(updated);
}));

templatesRouter.delete('/:id', canWrite, asyncHandler(async (req, res) => {
  if (TEMPLATES.some((t) => t.id === req.params.id)) return res.status(400).json({ error: 'Built-in templates cannot be deleted' });
  res.json({ deleted: await store.deleteTemplate(req.params.id, req.user.orgId) });
}));

function clean(b = {}) {
  const out = {};
  if (typeof b.name === 'string') out.name = b.name.trim().slice(0, 80);
  if (typeof b.subject === 'string') out.subject = b.subject.trim().slice(0, 200);
  if (typeof b.body === 'string') out.body = b.body.slice(0, 8000);
  return out;
}
