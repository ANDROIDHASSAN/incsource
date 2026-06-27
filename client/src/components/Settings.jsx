import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useEscapeClose } from '../useEscapeClose.js';

// One credential field with an eye-reveal toggle.
function KeyField({ label, value, onChange, show, onToggle, placeholder }) {
  return (
    <>
      <label className="field-label">{label}</label>
      <div className="key-input">
        <input
          className="input full"
          type={show ? 'text' : 'password'}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="button" className="key-eye" onClick={onToggle} title={show ? 'Hide' : 'Show'} aria-label={show ? 'Hide key' : 'Show key'}>
          {show ? '🙈' : '👁'}
        </button>
      </div>
    </>
  );
}

export function Settings({ onClose, onSaved, toast }) {
  const [status, setStatus] = useState(null);
  const [models, setModels] = useState([]);
  const [groqKey, setGroqKey] = useState('');
  const [model, setModel] = useState('llama-3.3-70b-versatile');
  const [apifyKey, setApifyKey] = useState('');
  const [showGroq, setShowGroq] = useState(false);
  const [showApify, setShowApify] = useState(false);
  const [busy, setBusy] = useState('');
  useEscapeClose(onClose);

  // Load masked status (for the pills + model), models, and the raw keys to
  // pre-fill the inputs so the user can see/edit what's already stored.
  async function load() {
    const [s, m, reveal] = await Promise.all([
      api.settings(),
      api.groqModels().catch(() => ({ models: [] })),
      api.revealSettings().catch(() => null),
    ]);
    setStatus(s);
    setModels(m.models || []);
    if (s.groq?.model) setModel(s.groq.model);
    if (reveal) {
      setGroqKey(reveal.groq?.key || '');
      setApifyKey(reveal.apify?.token || '');
    }
  }
  useEffect(() => { load(); }, []);

  async function saveGroq() {
    setBusy('groq');
    try {
      const res = await api.saveSettings({ groqKey: groqKey.trim(), groqModel: model });
      if (res.error) { toast(res.error, 'err'); return; }
      setStatus(res);
      toast(res.ai ? 'Groq key saved — AI matching enabled ✓' : 'Groq settings saved', res.ai ? 'ok' : undefined);
      onSaved?.(res);
    } catch { toast('Could not save', 'err'); } finally { setBusy(''); }
  }

  async function deleteGroq() {
    if (!window.confirm('Delete the Groq API key? AI matching will be disabled.')) return;
    setBusy('groq');
    try {
      const res = await api.saveSettings({ groqKey: '' });
      setStatus(res); setGroqKey(''); setShowGroq(false);
      toast('Groq key deleted');
      onSaved?.(res);
    } finally { setBusy(''); }
  }

  async function saveApify() {
    setBusy('apify');
    try {
      const res = await api.saveSettings({ apifyToken: apifyKey.trim() });
      if (res.error) { toast(res.error, 'err'); return; }
      setStatus(res);
      toast(res.apify?.configured ? 'Apify token saved ✓' : 'Apify settings saved', 'ok');
      onSaved?.(res);
    } catch { toast('Could not save', 'err'); } finally { setBusy(''); }
  }

  async function deleteApify() {
    if (!window.confirm('Delete the Apify token? Live sourcing will fall back to sample data.')) return;
    setBusy('apify');
    try {
      const res = await api.saveSettings({ apifyToken: '' });
      setStatus(res); setApifyKey(''); setShowApify(false);
      toast('Apify token deleted');
      onSaved?.(res);
    } finally { setBusy(''); }
  }

  const groqSet = status?.groq?.configured;
  const apifySet = status?.apify?.configured;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <header className="jd-head">
          <div className="jd-spark">🔑</div>
          <div>
            <h2>API keys</h2>
            <p className="modal-headline">Add, view, edit, or delete your keys. Stored on the server (server/.env).</p>
          </div>
        </header>

        <div style={{ padding: '22px 26px' }}>
          {/* ── Groq ── */}
          <div className="setting-block">
            <div className="setting-head">
              <div>
                <div className="setting-title">Groq — AI JD matching</div>
                <div className="setting-sub">Semantic candidate↔JD fit. Get a free key at console.groq.com/keys</div>
              </div>
              <span className={`pill-status ${groqSet ? 'on' : 'off'}`}>{groqSet ? 'connected' : 'not set'}</span>
            </div>

            <KeyField label="API key" value={groqKey} onChange={setGroqKey} show={showGroq} onToggle={() => setShowGroq((v) => !v)} placeholder="gsk_…" />

            <label className="field-label">Model</label>
            <select className="input select full" value={model} onChange={(e) => setModel(e.target.value)}>
              {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>

            <div className="setting-actions">
              <button className="btn primary" onClick={saveGroq} disabled={busy === 'groq'}>
                {busy === 'groq' ? 'Saving…' : groqSet ? 'Update' : 'Save & enable'}
              </button>
              {groqSet && <button className="btn danger" onClick={deleteGroq} disabled={busy === 'groq'}>Delete</button>}
            </div>
          </div>

          {/* ── Apify ── */}
          <div className="setting-block">
            <div className="setting-head">
              <div>
                <div className="setting-title">Apify — sourcing</div>
                <div className="setting-sub">Powers live candidate sourcing. Get a token at console.apify.com/account/integrations</div>
              </div>
              <span className={`pill-status ${apifySet ? 'on' : 'off'}`}>{apifySet ? 'connected' : 'not set'}</span>
            </div>

            <KeyField label="API token" value={apifyKey} onChange={setApifyKey} show={showApify} onToggle={() => setShowApify((v) => !v)} placeholder="apify_api_…" />

            <div className="setting-actions">
              <button className="btn primary" onClick={saveApify} disabled={busy === 'apify'}>
                {busy === 'apify' ? 'Saving…' : apifySet ? 'Update' : 'Save & connect'}
              </button>
              {apifySet && <button className="btn danger" onClick={deleteApify} disabled={busy === 'apify'}>Delete</button>}
            </div>
          </div>

          <p className="muted sm" style={{ marginTop: 14 }}>
            Keys are written to <code>server/.env</code> and applied instantly — no restart needed.
          </p>
        </div>
      </div>
    </div>
  );
}
