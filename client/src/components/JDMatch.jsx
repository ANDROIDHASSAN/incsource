import { useState } from 'react';
import { api } from '../api.js';
import { ScoreRing } from './ScoreRing.jsx';
import { useEscapeClose } from '../useEscapeClose.js';

function initials(name) {
  return name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
}

export function JDMatch({ onClose, onOpenCandidate, providers = [], toast }) {
  const [jd, setJd] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const [sourceLive, setSourceLive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  useEscapeClose(onClose);

  async function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = '';
    const name = f.name.toLowerCase();
    if (name.endsWith('.txt') || name.endsWith('.md') || f.type.startsWith('text/')) {
      const reader = new FileReader();
      reader.onload = () => setJd(String(reader.result || ''));
      reader.readAsText(f);
      return;
    }
    try {
      const res = await api.uploadJD(f);
      if (res.error) { toast(res.error, 'err'); return; }
      setJd(res.text || '');
      toast(`Loaded JD from ${res.name || f.name}`, 'ok');
    } catch {
      toast('Could not read that file', 'err');
    }
  }

  async function findMatches() {
    if (jd.trim().length < 20) { toast('Paste a fuller job description', 'err'); return; }
    setLoading(true);
    try {
      const res = await api.match({ jd, activeOnly, sourceLive, top: 60 });
      if (res.error) { toast(res.error, 'err'); return; }
      setResult(res);
      toast(`${res.total} best-fit candidates${res.aiUsed ? ' · AI-ranked' : ''}${res.sourced ? ` · sourced ${res.sourced.kept} fresh` : ''}`, 'ok');
    } catch {
      toast('Match failed', 'err');
    } finally {
      setLoading(false);
    }
  }

  const jd_ = result?.jd;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal jd-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>

        <header className="jd-head">
          <div className="jd-spark">✦</div>
          <div>
            <h2>Match candidates to a job description</h2>
            <p className="modal-headline">Paste a JD — IncSource extracts the requirements and ranks your actively-applying candidates by fit.</p>
          </div>
        </header>

        <div className="jd-body">
          <div className="jd-input-col">
            <textarea
              className="jd-textarea"
              placeholder="Paste the full job description here…&#10;&#10;e.g. We're hiring a Senior React Developer in Bengaluru. Must have React.js, Node.js, MongoDB, REST APIs. 3+ years…"
              value={jd}
              onChange={(e) => setJd(e.target.value)}
            />
            <div className="jd-controls">
              <label className="jd-file btn sm">
                ⤓ Upload JD
                <input type="file" accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown" onChange={onFile} hidden />
              </label>
              <label className="chk"><input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />Only actively-applying</label>
              <label className="chk"><input type="checkbox" checked={sourceLive} onChange={(e) => setSourceLive(e.target.checked)} />Source fresh for this JD</label>
            </div>
            <button className="btn primary full" onClick={findMatches} disabled={loading}>
              {loading ? 'Matching…' : '✦ Find best-fit candidates'}
            </button>

            {jd_ && (
              <div className="jd-parsed">
                <div className="dossier-h">Extracted requirements</div>
                <div className="jd-req"><span>Role</span><b>{jd_.title || '—'}</b></div>
                <div className="jd-req"><span>Seniority</span><b>{jd_.seniority}{jd_.minExperience ? ` · ${jd_.minExperience}+ yrs` : ''}</b></div>
                <div className="jd-req"><span>Location</span><b>{jd_.location || 'Any'}</b></div>
                <div className="jd-req col"><span>Skills</span>
                  <div className="chips">{(jd_.skills || []).map((s) => <span key={s} className="chip">{s}</span>)}</div>
                </div>
              </div>
            )}
          </div>

          <div className="jd-results-col">
            {!result ? (
              <div className="jd-empty">
                <div className="empty-mark">✦</div>
                <p>Your ranked best-fit matches will appear here.</p>
              </div>
            ) : result.matches.length === 0 ? (
              <div className="jd-empty"><p>No matching candidates yet. Try “Source fresh for this JD”, or loosen “actively-applying”.</p></div>
            ) : (
              <>
                <div className="jd-results-head">
                  {result.total} best-fit candidates · {result.aiUsed ? '✦ AI-ranked by true fit' : 'ranked by fit'}
                </div>
                <div className="jd-matches">
                  {result.matches.map((m) => {
                    const c = m.candidate;
                    const band = m.fitScore >= 70 ? 'hot' : m.fitScore >= 40 ? 'warm' : 'cold';
                    const matched = m.ai?.matched || m.matchedSkills;
                    const missing = m.ai?.missing || m.missingSkills;
                    return (
                      <div key={c.id} className="match-card" onClick={() => onOpenCandidate(c)}>
                        <div className="avatar">{initials(c.fullName)}</div>
                        <div className="match-info">
                          <div className="match-top">
                            <h4>{c.fullName}</h4>
                            {m.verdict && <span className={`verdict ${m.verdict}`}>{m.verdict}</span>}
                            {c.openToWork && <span className="badge open">Open to work</span>}
                          </div>
                          <p className="match-sub">{c.currentTitle || c.headline} · {[c.city, c.state].filter(Boolean).join(', ')}</p>
                          {m.ai?.reason && <p className="match-reason">“{m.ai.reason}”</p>}
                          <div className="match-skills">
                            {(matched || []).slice(0, 8).map((s) => <span key={s} className="ms ok">{s}</span>)}
                            {(missing || []).slice(0, 4).map((s) => <span key={s} className="ms miss">{s}</span>)}
                          </div>
                        </div>
                        <div className="score">
                          <ScoreRing score={m.fitScore} size={50} />
                          <span className={`band-pill ${band}`}>fit</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
