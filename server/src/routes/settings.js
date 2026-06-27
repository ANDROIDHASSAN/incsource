import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { asyncHandler, requireAuth } from '../middleware/index.js';
import { applySettings, settingsStatus, revealSettings, config } from '../config.js';

export const settingsRouter = Router();

const ENV_PATH = path.resolve(process.cwd(), '.env');

// Upsert a KEY=value line in server/.env so the key survives restarts.
function persistEnv(updates) {
  let text = '';
  try { text = fs.readFileSync(ENV_PATH, 'utf8'); } catch { /* no .env yet */ }
  for (const [key, value] of Object.entries(updates)) {
    if (value == null) continue;
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, line) : `${text}${text.endsWith('\n') || !text ? '' : '\n'}${line}\n`;
  }
  try { fs.writeFileSync(ENV_PATH, text); } catch (e) { console.warn('Could not persist .env:', e.message); }
}

settingsRouter.get('/', (_req, res) => res.json(settingsStatus()));

// Raw keys for the eye-reveal / pre-fill. Requires a signed-in user.
settingsRouter.get('/reveal', requireAuth(), (_req, res) => res.json(revealSettings()));

settingsRouter.post('/', asyncHandler(async (req, res) => {
  const groqKey = typeof req.body?.groqKey === 'string' ? req.body.groqKey.trim() : undefined;
  const groqModel = typeof req.body?.groqModel === 'string' ? req.body.groqModel.trim() : undefined;
  const apifyToken = typeof req.body?.apifyToken === 'string' ? req.body.apifyToken.trim() : undefined;

  // Save whatever the user provides — we never block on key format. If a key is
  // wrong, the real provider call will report it; we don't pre-judge the prefix.
  applySettings({ groqKey, groqModel, apifyToken });
  // Persist (empty value clears it).
  persistEnv({
    ...(groqKey !== undefined ? { GROQ_API_KEY: groqKey } : {}),
    ...(groqModel ? { GROQ_MODEL: groqModel } : {}),
    ...(apifyToken !== undefined ? { APIFY_TOKEN: apifyToken } : {}),
  });

  res.json({ ok: true, ...settingsStatus() });
}));

// Available Groq models for the dropdown.
settingsRouter.get('/groq-models', (_req, res) => {
  res.json({
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B — best accuracy (default)' },
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B — fastest / cheapest' },
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B — strongest reasoning' },
    ],
    current: config.groq.model,
  });
});
