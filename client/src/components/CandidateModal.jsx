import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ScoreRing } from './ScoreRing.jsx';
import { useEscapeClose } from '../useEscapeClose.js';

function initials(name) {
  return name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
}

export function CandidateModal({ candidate, meta, templates = [], sourceMeta, onUpdate, onClose, onDelete, toast }) {
  const tpls = templates.length ? templates : meta.templates || [];
  const [c, setC] = useState(candidate);
  const [notes, setNotes] = useState(candidate.notes || '');
  const [savingNotes, setSavingNotes] = useState(false);
  const [tplId, setTplId] = useState((tpls[0] || {}).id || 'intro');
  const [preview, setPreview] = useState(null);
  const [role, setRole] = useState(candidate.currentTitle || '');
  const [enriching, setEnriching] = useState(false);
  const [sending, setSending] = useState(false);

  async function sendNow() {
    if (!c.email) { toast('No email — run Find email first', 'err'); return; }
    setSending(true);
    try {
      const res = await api.sendEmail(c.id, { templateId: tplId, role });
      if (res.error) { toast(res.error, 'err'); return; }
      if (res.candidate) { setC(res.candidate); onUpdate(res.candidate); }
      toast('Email sent ✓', 'ok');
      if (res.previewUrl) window.open(res.previewUrl, '_blank');
    } catch {
      toast('Send failed', 'err');
    } finally {
      setSending(false);
    }
  }

  async function findContact() {
    setEnriching(true);
    try {
      const res = await api.enrich(c.id);
      if (res.error) { toast(res.error, 'err'); return; }
      setC(res.candidate);
      onUpdate(res.candidate);
      toast(res.found?.email ? 'Email found ✓' : 'No email found for this candidate', res.found?.email ? 'ok' : 'err');
    } catch {
      toast('Enrichment failed', 'err');
    } finally {
      setEnriching(false);
    }
  }

  useEffect(() => { setC(candidate); setNotes(candidate.notes || ''); }, [candidate]);

  useEscapeClose(onClose);

  const band = c.activeScore >= 70 ? 'hot' : c.activeScore >= 40 ? 'warm' : 'cold';
  const place = [c.city, c.state, c.country].filter(Boolean).join(', ');

  async function patch(body, msg) {
    const updated = await api.patch(c.id, body);
    setC(updated);
    onUpdate(updated);
    if (msg) toast(msg);
  }

  async function saveNotes() {
    setSavingNotes(true);
    try { await patch({ notes }, 'Notes saved'); } finally { setSavingNotes(false); }
  }

  async function loadPreview(id = tplId) {
    const p = await api.outreachPreview(c.id, { templateId: id, role, recruiter: '' });
    setPreview(p);
  }

  function openEmail() {
    if (!preview) return;
    const to = c.email || '';
    const url = `mailto:${to}?subject=${encodeURIComponent(preview.subject)}&body=${encodeURIComponent(preview.body)}`;
    window.open(url, '_blank');
  }

  async function copyMessage() {
    if (!preview) return;
    await navigator.clipboard.writeText(`Subject: ${preview.subject}\n\n${preview.body}`);
    toast('Message copied to clipboard');
  }

  async function markContacted() {
    const updated = await api.outreachLog(c.id, { channel: 'email', subject: preview?.subject || '' });
    setC(updated);
    onUpdate(updated);
    toast(`Logged outreach · ${updated.fullName} → Contacted`);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>

        <header className="modal-head">
          <div className="avatar lg">{initials(c.fullName)}</div>
          <div className="modal-head-info">
            <div className="modal-name-row">
              <h2>{c.fullName}</h2>
              <button className={`star ${c.starred ? 'on' : ''}`} onClick={() => patch({ starred: !c.starred }, c.starred ? 'Removed from shortlist' : 'Added to shortlist')} title="Shortlist">
                {c.starred ? '★' : '☆'}
              </button>
            </div>
            <p className="modal-headline">{c.headline || c.currentTitle}</p>
            <div className="modal-badges">
              {c.recordType === 'job-lead' && <span className="badge lead">Hiring lead</span>}
              {c.openToWork && <span className="badge open">Open to work</span>}
              {c.appliedToJob && <span className="badge applied">Applied: {c.appliedToJob}</span>}
              {(c.sources || [c.source]).map((s) => {
                const m = sourceMeta[s] || { dot: '#9aa0a8', label: s };
                return <span key={s} className="badge src"><span className="cite-dot" style={{ background: m.dot }} />{m.label}</span>;
              })}
            </div>
          </div>
          <div className="modal-score">
            <ScoreRing score={c.activeScore} size={76} />
            <span className={`band-pill ${band}`}>{band} · {Math.round(c.activeScore)}</span>
          </div>
        </header>

        {/* Pipeline */}
        <div className="pipeline">
          {(meta.stages || []).map((s) => (
            <button key={s} className={`stage ${c.status === s ? 'on' : ''}`} onClick={() => patch({ status: s }, `Moved to ${s}`)}>
              {s}
            </button>
          ))}
        </div>

        <div className="modal-body">
          <div className="modal-main">
            <section className="m-sec">
              <h4>Details</h4>
              <dl className="kv">
                {c.currentCompany && <><dt>Company</dt><dd>{c.currentCompany}</dd></>}
                {c.currentTitle && <><dt>Title</dt><dd>{c.currentTitle}</dd></>}
                {place && <><dt>Location</dt><dd>{place}</dd></>}
                {c.noticePeriodDays != null && <><dt>Notice</dt><dd>{c.noticePeriodDays === 0 ? 'Immediate joiner' : `${c.noticePeriodDays} days`}</dd></>}
                <dt>Email</dt>
                <dd className="contact-row">
                  {c.email ? <a href={`mailto:${c.email}`}>✉ {c.email}</a> : <span className="muted">Not found yet</span>}
                </dd>
                {c.profileUrl && <><dt>Profile</dt><dd className="contact-row"><a href={c.profileUrl} target="_blank" rel="noreferrer">LinkedIn ↗</a></dd></>}
              </dl>
              {!c.email && (
                <button className="btn primary find-contact" onClick={findContact} disabled={enriching}>
                  {enriching ? 'Searching…' : '🔎 Find email'}
                </button>
              )}
            </section>

            <section className="m-sec">
              <h4>Active-intent signals</h4>
              <ul className="why">
                {(c.scoreBreakdown || []).map((b, i) => (
                  <li key={i}><span>{b.label}</span><b>+{b.points}</b></li>
                ))}
                {(!c.scoreBreakdown || !c.scoreBreakdown.length) && <li className="muted">No signals detected.</li>}
              </ul>
            </section>

            {(c.skills || []).length > 0 && (
              <section className="m-sec">
                <h4>Skills</h4>
                <div className="chips">{c.skills.map((s) => <span key={s} className="chip">{s}</span>)}</div>
              </section>
            )}

            <section className="m-sec">
              <h4>Recruiter notes</h4>
              <textarea className="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add private notes about this candidate…" rows={3} />
              <button className="btn sm" onClick={saveNotes} disabled={savingNotes || notes === (c.notes || '')}>{savingNotes ? 'Saving…' : 'Save notes'}</button>
            </section>
          </div>

          <div className="modal-side">
            <section className="m-sec">
              <h4>Outreach</h4>
              <label className="field-label">Template</label>
              <select className="input select full" value={tplId} onChange={(e) => { setTplId(e.target.value); setPreview(null); }}>
                {tpls.map((t) => <option key={t.id} value={t.id}>{t.name}{t.custom ? ' ·custom' : ''}</option>)}
              </select>
              <label className="field-label">Role mentioned</label>
              <input className="input full" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Senior React Developer" />
              <button className="btn primary full" onClick={() => loadPreview()}>Preview message</button>

              {preview && (
                <div className="preview">
                  <div className="preview-subj">{preview.subject}</div>
                  <pre className="preview-body">{preview.body}</pre>
                  <div className="preview-actions">
                    <button className="btn sm ok" onClick={sendNow} disabled={sending || !c.email} title={c.email ? 'Send via server' : 'No email on file'}>
                      {sending ? 'Sending…' : '✈ Send email'}
                    </button>
                    <button className="btn sm" onClick={openEmail} disabled={!c.email}>Open in mail app</button>
                    <button className="btn sm" onClick={copyMessage}>Copy</button>
                  </div>
                  {!c.email && <p className="muted sm">No email on file — copy the message and reach out via the profile link.</p>}
                </div>
              )}

              {(c.outreachLog || []).length > 0 && (
                <div className="outreach-log">
                  <div className="ol-title">History · {c.outreachCount}</div>
                  {(c.outreachLog || []).slice(0, 4).map((o, i) => (
                    <div key={i} className="ol-item">{o.channel} · {new Date(o.at).toLocaleDateString()}</div>
                  ))}
                </div>
              )}
            </section>

            <button className="btn danger full" onClick={() => onDelete(c.id)}>Delete candidate · GDPR</button>
          </div>
        </div>
      </div>
    </div>
  );
}
