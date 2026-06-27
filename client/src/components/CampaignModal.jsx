import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useEscapeClose } from '../useEscapeClose.js';

export function CampaignModal({ ids, templates, onClose, onDone, toast }) {
  const [tplId, setTplId] = useState((templates[0] || {}).id || 'intro');
  const [role, setRole] = useState('');
  const [sending, setSending] = useState(false);
  const [findFirst, setFindFirst] = useState(false);
  const [result, setResult] = useState(null);
  const [quota, setQuota] = useState(null); // { sentToday, dailyCap, remaining, mode }
  useEscapeClose(onClose);

  // Show the recruiter how much daily headroom they have BEFORE sending, so a big
  // selection doesn't silently hit the ban-safety cap mid-campaign.
  useEffect(() => { api.usage().then((d) => setQuota(d.email)).catch(() => {}); }, []);

  const remaining = quota?.remaining;
  const willSend = remaining == null ? ids.length : Math.min(ids.length, remaining);
  const overCap = remaining != null && ids.length > remaining;

  async function send() {
    setSending(true);
    try {
      if (findFirst) {
        const en = await api.enrichBulk(ids);
        if (en?.error) { toast(en.error, 'err'); }
        else if (en?.withEmail != null) toast(`Found ${en.withEmail} email${en.withEmail === 1 ? '' : 's'}`, 'ok');
      }
      const res = await api.campaign({ ids, templateId: tplId, role });
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
          <div><h2>Send email campaign</h2><p className="modal-headline">{ids.length} candidates selected · only those with an email receive it.</p></div>
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
              <label className="field-label">Template</label>
              <select className="input select full" value={tplId} onChange={(e) => setTplId(e.target.value)}>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.custom ? ' ·custom' : ''}</option>)}
              </select>
              <label className="field-label">Role mentioned (optional)</label>
              <input className="input full" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Senior React Developer" />
              <label className="chk" style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={findFirst} onChange={(e) => setFindFirst(e.target.checked)} />
                Find missing emails first <span className="prem">$</span>
              </label>
              <button className="btn primary full" onClick={send} disabled={sending || willSend <= 0} style={{ marginTop: 14 }}>
                {sending ? `Sending to ${willSend}…` : willSend <= 0 ? 'Daily limit reached' : `✈ Send to ${willSend} candidate${willSend === 1 ? '' : 's'}`}
              </button>
              <p className="muted sm" style={{ marginTop: 10 }}>Sends are throttled with random gaps to protect your account from being flagged. Each recipient is logged and moved to “Contacted”.</p>
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
