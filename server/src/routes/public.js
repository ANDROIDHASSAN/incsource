// Public, UNAUTHENTICATED routes — mounted before the JWT gate. The only thing
// here is candidate-facing resume collection: a candidate opens the unique link
// from their outreach email and uploads their CV, which we parse and attach to
// their profile. Authorization is the unguessable per-candidate token itself.
import { Router } from 'express';
import multer from 'multer';
import { store } from '../store/index.js';
import { asyncHandler, rateLimit } from '../middleware/index.js';
import { extractDocText, buildResumeRecord } from '../services/resumeText.js';

export const publicRouter = Router();

// In-memory upload, capped at 8MB — we only need the extracted text.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// What the upload page shows before the candidate uploads — just enough to greet
// them and confirm the link is valid. Never leaks PII beyond their own first name.
publicRouter.get('/resume/:token', rateLimit({ windowMs: 60_000, max: 60 }), asyncHandler(async (req, res) => {
  const c = await store.findByResumeToken(req.params.token);
  if (!c) return res.status(404).json({ error: 'This upload link is invalid or has expired.' });
  res.json({
    ok: true,
    firstName: (c.fullName || '').split(' ')[0] || 'there',
    role: c.currentTitle || '',
    alreadyUploaded: Boolean(c.resume),
  });
}));

// The candidate uploads their resume → parse → attach to their profile.
publicRouter.post(
  '/resume/:token',
  rateLimit({ windowMs: 60_000, max: 20 }),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const c = await store.findByResumeToken(req.params.token);
    if (!c) return res.status(404).json({ error: 'This upload link is invalid or has expired.' });
    const f = req.file;
    if (!f) return res.status(400).json({ error: 'Please choose a resume file (PDF or Word).' });
    let text;
    try {
      text = await extractDocText(f.buffer, f.originalname, f.mimetype);
    } catch (e) {
      return res.status(e.status || 422).json({ error: e.message || 'Couldn’t read that file — try a PDF or .docx.' });
    }
    if (!text) return res.status(422).json({ error: 'No readable text found in that file.' });
    const record = buildResumeRecord({ text, filename: f.originalname, size: f.size, mimetype: f.mimetype });
    await store.attachResumeByToken(req.params.token, record);
    res.json({ ok: true, message: 'Thanks! Your resume has been received.' });
  })
);
