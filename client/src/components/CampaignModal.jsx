import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useEscapeClose } from '../useEscapeClose.js';

// Placeholders a recruiter can drop into a custom template / subject / body.
const TOKENS = ['{{firstName}}', '{{name}}', '{{experience}}', '{{role}}', '{{requirements}}', '{{resumeLink}}', '{{skillLine}}', '{{recruiter}}', '{{company}}'];

export function CampaignModal({ ids, templates, onClose, onDone, toast, scope = 'selected', defaultRole = '', defaultRequirements = '', onTemplatesChanged }) {
  const [tpls, setTpls] = useState(templates);
  const [tplId, setTplId] = useState((templates[0] || {}).id || 'intro');
  const [role, setRole] = useState(defaultRole);
  const [requirements, setRequirements] = useState(defaultRequirements);
  const [resumeRequest, setResumeRequest] = useState(true); // collecting resumes is the goal
  const [sending, setSending] = useState(false);
  const [findFirst, setFindFirst] = useState(false);
  const [result, setResult] = useState(null);
  const [quota, setQuota] = useState(null); // { sentToday, dailyCap, remaining, mode }
  // Inline "create template" composer.
  const [creating, setCreating] = useState(false);
  const [nt, setNt] = useState({ name: '', subject: '', body: '' });
  const [savingTpl, setSavingTpl] = useState(false);
  useEscapeClose(onClose);

  // Show the recruiter how much daily headroom they have BEFORE sending, so a big
  // selection doesn't silently hit the ban-safety cap mid-campaign.
  useEffect(() => { api.usage().then((d) => setQuota(d.email)).catch(() => {}); }, []);

  const remaining = quota?.remaining;
  const willSend = remaining == null ? ids.length : Math.min(ids.length, remaining);
  const overCap = remaining != null && ids.length > remaining;
  const selectedTpl = tpls.find((t) => t.id === tplId);
  // When the resume template is chosen, the link is essential — keep it on.
  const resumeTpl = tplId === 'resume';

  async function saveTemplate() {
    if (!nt.name.trim() || !nt.subject.trim() || !nt.body.trim()) { toast('Give the template a name, subject and body', 'err'); return; }
    setSavingTpl(true);
    try {
      const created = await api.createTemplate(nt);
      if (created?.error || !created?.id) { toast(created?.error || 'Could not save template', 'err'); return; }
      const next = [...tpls, { ...created, custom: true }];
      setTpls(next);
      setTplId(created.id);
      setCreating(false);
      setNt({ name: '', subject: '', body: '' });
      onTemplatesChanged?.();
      toast('Template saved', 'ok');
    } catch { toast('Could not save template', 'err'); }
    finally { setSavingTpl(false); }
  }

  async function send() {
    setSending(true);
    try {
      if (findFirst) {
        const en = await api.enrichBulk(ids);
        if (en?.error) { toast(en.error, 'err'); }
        else if (en?.withEmail != null) toast(`Found ${en.withEmail} email${en.withEmail === 1 ? '' : 's'}`, 'ok');
      }
      const res = await api.campaign({ ids, templateId: tplId, role, requirements, resumeRequest });
      if (res.error && res.sent == null) { toast(res.error, 'err'); return; }
      setResult(res);
      const extra = res.capped ? ` · ${res.capped} held (daily cap)` : '';
      toast(`Campaign: ${res.sent} sent · ${res.skipped} skipped · ${res.failed} failed${extra}`, res.failed || res.capped ? 'err' : 'ok');
      onDone();
    } catch {
      toast('Campaign failed', 'err');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal campaign-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <header className="jd-head">
          <div className="jd-spark">✈</div>
          <div>
            <h2>{scope === 'all' ? 'Email all matching candidates' : 'Send email campaign'}</h2>
            <p className="modal-headline">{ids.length} {scope === 'all' ? 'in the current view' : 'selected'} · personalized with each name & experience · only those with an email receive it.</p>
          </div>
        </header>

        <div style={{ padding: '22px 26px' }}>
          {!result ? (
            <>
              {quota && (
                <div className={`cap-banner ${overCap ? 'warn' : ''} ${quota.mode !== 'smtp' ? 'test' : ''}`}>
                  {quota.mode !== 'smtp'
                    ? <>Test mode — emails are <b>not delivered</b> (preview links only). {quota.remaining} of {quota.dailyCap} daily slots left.</>
                    : overCap
                      ? <>Only <b>{quota.remaining}</b> of {quota.dailyCap} daily sends left — the first {quota.remaining} go out, the rest are held until tomorrow (keeps your account safe).</>
                      : <><b>{quota.remaining}</b> of {quota.dailyCap} daily email sends remaining today.</>}
                </div>
              )}

              <div className="row-between">
                <label className="field-label">Template</label>
                <button type="button" className="link-btn" onClick={() => setCreating((v) => !v)}>{creating ? 'Cancel' : '+ New template'}</button>
              </div>
              {!creating ? (
                <select className="input select full" value={tplId} onChange={(e) => setTplId(e.target.value)}>
                  {tpls.map((t) => <option key={t.id} value={t.id}>{t.name}{t.custom ? ' ·custom' : ''}</option>)}
                </select>
              ) : (
                <div className="tpl-creator">
                  <input className="input full" placeholder="Template name" value={nt.name} onChange={(e) => setNt({ ...nt, name: e.target.value })} />
                  <input className="input full" placeholder="Subject — e.g. {{role}} role for {{firstName}}" value={nt.subject} onChange={(e) => setNt({ ...nt, subject: e.target.value })} style={{ marginTop: 8 }} />
                  <textarea className="input full" rows={6} placeholder={'Body…\nHi {{firstName}}, I saw your {{experience}}…\n{{requirements}}\nShare your resume: {{resumeLink}}'} value={nt.body} onChange={(e) => setNt({ ...nt, body: e.target.value })} style={{ marginTop: 8, resize: 'vertical' }} />
                  <div className="token-hints">{TOKENS.map((t) => <button type="button" key={t} className="token-chip" onClick={() => setNt((n) => ({ ...n, body: `${n.body}${t}` }))}>{t}</button>)}</div>
                  <button className="btn primary sm" onClick={saveTemplate} disabled={savingTpl} style={{ marginTop: 8 }}>{savingTpl ? 'Saving…' : 'Save template'}</button>
                </div>
              )}

              <label className="field-label" style={{ marginTop: 14 }}>Role / title</label>
              <input className="input full" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Senior React Developer" />

              <label className="field-label" style={{ marginTop: 14 }}>Our requirements / JD <span className="muted sm">— inserted as {'{{requirements}}'}</span></label>
              <textarea className="input full" rows={3} value={requirements} onChange={(e) => setRequirements(e.target.value)} placeholder="e.g. 5+ yrs React & Node.js, REST APIs, immediate joiner preferred." style={{ resize: 'vertical' }} />

              <label className="chk" style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={resumeRequest} onChange={(e) => setResumeRequest(e.target.checked)} />
                Include a resume-upload link <span className="muted sm">— each candidate gets a unique {'{{resumeLink}}'} to send us their CV</span>
              </label>
              {resumeTpl && !resumeRequest && <p className="muted sm" style={{ color: '#b45309' }}>The “Resume request” template references the link — keep this on so it isn’t blank.</p>}

              <label className="chk" style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={findFirst} onChange={(e) => setFindFirst(e.target.checked)} />
                Find missing emails first <span className="prem">$</span>
              </label>

              {selectedTpl && <details className="tpl-preview"><summary>Preview “{selectedTpl.name}”</summary><pre>{(selectedTpl.subject ? `Subject: ${selectedTpl.subject}\n\n` : '') + (selectedTpl.body || '')}</pre></details>}

              <button className="btn primary full" onClick={send} disabled={sending || willSend <= 0} style={{ marginTop: 14 }}>
                {sending ? `Sending to ${willSend}…` : willSend <= 0 ? 'Daily limit reached' : `✈ Send to ${willSend} candidate${willSend === 1 ? '' : 's'}`}
              </button>
              <p className="muted sm" style={{ marginTop: 10 }}>Each email is personalized with the candidate’s name & experience and your role + requirements. Sends are throttled with random gaps to protect your account. Each recipient is logged and moved to “Contacted”.</p>
            </>
          ) : (
            <div className="campaign-result">
              <div className="cr-stats">
                <div className="cr-stat ok"><b>{result.sent}</b>sent</div>
                <div className="cr-stat"><b>{result.skipped}</b>skipped</div>
                <div className="cr-stat err"><b>{result.failed}</b>failed</div>
                {result.capped > 0 && <div className="cr-stat warn"><b>{result.capped}</b>held</div>}
              </div>
              {result.remaining != null && <p className="muted sm" style={{ marginBottom: 10 }}>{result.remaining} daily sends left.</p>}
              <div className="cr-list">
                {result.results.map((r) => (
                  <div key={r.id} className={`cr-row ${r.status}`}>
                    <span>{r.name}</span>
                    <span className="cr-status">{r.status}{r.previewUrl && <a href={r.previewUrl} target="_blank" rel="noreferrer"> · preview</a>}{r.reason ? ` · ${r.reason}` : ''}</span>
                  </div>
                ))}
              </div>
              <button className="btn full" onClick={onClose} style={{ marginTop: 14 }}>Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
