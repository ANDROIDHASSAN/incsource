import { Router } from 'express';
import multer from 'multer';
import { store } from '../store/index.js';
import { asyncHandler, rateLimit, singleFlight } from '../middleware/index.js';
import { parseJD, matchCandidates } from '../services/jdMatch.js';
import { aiScore } from '../services/aiMatch.js';
import { runSourcing } from '../services/ingest.js';
import { usingAI } from '../config.js';

export const matchRouter = Router();

// In-memory upload (max 8MB) for JD files — we only need the extracted text.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// Extract plain text from an uploaded JD: PDF, Word (.docx), or plain text.
matchRouter.post('/upload', upload.single('file'), asyncHandler(async (req, res) => {
  const f = req.file;
  if (!f) return res.status(400).json({ error: 'No file uploaded.' });
  const name = (f.originalname || '').toLowerCase();
  let text = '';
  try {
    if (name.endsWith('.pdf') || f.mimetype === 'application/pdf') {
      const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
      text = (await pdfParse(f.buffer)).text || '';
    } else if (name.endsWith('.docx') || f.mimetype.includes('wordprocessingml')) {
      const mammoth = (await import('mammoth')).default;
      text = (await mammoth.extractRawText({ buffer: f.buffer })).value || '';
    } else if (name.endsWith('.doc')) {
      return res.status(422).json({ error: 'Old .doc isn’t supported — save as .docx or PDF.' });
    } else {
      text = f.buffer.toString('utf8'); // .txt / .md / plain text
    }
  } catch (e) {
    return res.status(422).json({ error: `Couldn’t read “${f.originalname}” (${e.message.slice(0, 80)}).` });
  }
  text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) return res.status(422).json({ error: 'No readable text found in that file.' });
  res.json({ text: text.slice(0, 20000), chars: text.length, name: f.originalname });
}));

// Parse a JD only (preview the extracted requirements).
matchRouter.post('/parse', asyncHandler(async (req, res) => {
  const { skills } = await store.facets({ orgId: req.user.orgId });
  res.json(parseJD(req.body?.jd || '', (skills || []).map((s) => s.value)));
}));

// Match candidates to a JD. Optionally source fresh candidates for it first.
matchRouter.post(
  '/',
  rateLimit({ windowMs: 60_000, max: 20 }),
  singleFlight(),
  asyncHandler(async (req, res) => {
    const jdText = String(req.body?.jd || '');
    if (jdText.trim().length < 20) return res.status(400).json({ error: 'Paste a fuller job description (min 20 chars).' });

    const orgId = req.user.orgId;
    const { skills } = await store.facets({ orgId });
    const jd = parseJD(jdText, (skills || []).map((s) => s.value));
    if (req.body?.title) jd.title = String(req.body.title);

    let sourced = null;
    if (req.body?.sourceLive) {
      // Source fresh candidates for this exact role/location, then match.
      const q = [jd.title, ...(jd.skills || []).slice(0, 2)].filter(Boolean).join(' ');
      const run = await runSourcing({
        orgId,
        sources: req.body.sources || ['linkedin-harvest', 'apify-linkedin'],
        query: q,
        location: jd.location || 'India',
        limit: Math.min(Number(req.body.limit) || 25, 50),
        openToWorkOnly: true,
        indiaOnly: true,
      });
      sourced = { kept: run.run.kept, fetched: run.run.fetched };
    }

    const { candidates } = await store.listCandidates({ limit: 500, includeLeads: false, orgId });
    const activeOnly = req.body?.activeOnly !== false;
    let matches = matchCandidates(candidates, jd, { activeOnly });

    // AI re-rank: Claude judges true semantic fit on the deterministic shortlist.
    const wantAI = req.body?.ai !== false && usingAI();
    let aiUsed = false;
    if (wantAI && matches.length) {
      const ai = await aiScore(jd, matches.map((m) => m.candidate));
      if (ai.size) {
        aiUsed = true;
        const order = { strong: 0, possible: 1, weak: 2 };
        matches = matches
          .map((m) => {
            const a = ai.get(String(m.candidate.id));
            return a ? { ...m, ai: a, fitScore: a.fit, verdict: a.verdict } : { ...m, verdict: 'possible' };
          })
          .filter((m) => m.verdict !== 'weak')
          .sort((x, y) => (order[x.verdict] - order[y.verdict]) || (y.fitScore - x.fitScore));
      }
    }

    matches = matches.slice(0, Number(req.body?.top) || 60);
    res.json({ jd, sourced, aiUsed, total: matches.length, matches });
  })
);
