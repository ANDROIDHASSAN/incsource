import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useEscapeClose } from '../useEscapeClose.js';

// A quota bar showing ABSOLUTE used / limit, with a color that warns as it fills.
function Meter({ label, used, total, unit = '', note, hint }) {
  const known = typeof used === 'number' && typeof total === 'number' && total > 0;
  const pct = known ? Math.min(100, Math.round((used / total) * 100)) : null;
  const tone = pct == null ? 'na' : pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok';
  const fmt = (n) => (n == null ? '—' : unit === '$' ? `$${Number(n).toFixed(2)}` : Number(n).toLocaleString());
  return (
    <div className="uq-row">
      <div className="uq-head">
        <span className="uq-label">{label}</span>
        <span className={`uq-val ${tone}`}>
          {fmt(used)}{total != null ? <span className="uq-of"> / {fmt(total)}{unit && unit !== '$' ? ` ${unit}` : ''}</span> : ''}
        </span>
      </div>
      <div className="uq-bar"><span className={`uq-fill ${tone}`} style={{ width: `${pct ?? 0}%` }} /></div>
      {note && <div className={`uq-note ${tone}`}>{note}</div>}
      {hint && <div className="uq-hint">{hint}</div>}
    </div>
  );
}

// Human "resets in …" from an ISO timestamp (near-term → relative, far → date).
function resetFromDate(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return 'now';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 36) return `in ${hrs}h ${mins % 60}m`;
  return `on ${new Date(iso).toLocaleDateString()}`;
}

function ResetLine({ children }) {
  return <div className="uq-reset">↻ {children}</div>;
}

export function Usage({ onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  useEscapeClose(onClose);

  const load = () => {
    setLoading(true);
    api.usage()
      .then((d) => { setData(d); setErr(null); })
      .catch(() => setErr('Could not load usage'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const email = data?.email;
  const apify = data?.apify;
  const groq = data?.groq;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal usage-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <header className="modal-head usage-head">
          <div className="avatar lg">📊</div>
          <div className="modal-head-info">
            <h2>Usage &amp; quotas</h2>
            <p className="modal-headline">Real usage right now — stay under your daily limits.</p>
          </div>
          <button className="btn sm" onClick={load} disabled={loading} style={{ marginLeft: 'auto' }}>
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </header>

        {err && <div className="usage-err">{err}</div>}

        {data && (
          <div className="usage-body">
            {/* EMAIL */}
            <section className="uq-card">
              <div className="uq-title">
                ✉ Email — today
                <span className={`uq-chip ${email.mode === 'smtp' ? 'live' : 'mock'}`}>{email.mode === 'smtp' ? 'live' : 'test inbox'}</span>
              </div>
              <Meter
                label="Sent today"
                used={email.sentToday}
                total={email.dailyCap}
                note={email.remaining <= 0 ? 'Daily limit reached' : `${email.remaining} of ${email.dailyCap} left`}
                hint={email.mode === 'smtp' ? email.from : 'Test mode — emails are not delivered (preview only). Set SMTP to go live.'}
              />
              <ResetLine>Resets {resetFromDate(email.resetsAt) || 'daily'} (daily, UTC midnight)</ResetLine>
              <div className="uq-foot">Daily cap protects your sending account from being flagged/banned. Sends are throttled automatically.</div>
            </section>

            {/* APIFY */}
            <section className="uq-card">
              <div className="uq-title">🔎 Apify — sourcing spend (this cycle)</div>
              {apify?.configured === false ? (
                <div className="uq-hint">No Apify token set — add one in Tools → API keys to source candidates.</div>
              ) : apify?.error ? (
                <div className="uq-note over">Couldn’t read Apify usage: {apify.error}</div>
              ) : (
                <>
                  <Meter
                    label="Spend used"
                    used={apify.usedUsd}
                    total={apify.limitUsd}
                    unit="$"
                    note={apify.usedUsd >= apify.limitUsd ? 'Monthly limit exceeded — live sourcing paused' : `$${Math.max(0, (apify.limitUsd - apify.usedUsd)).toFixed(2)} left`}
                  />
                  {apify.computeUnitsLimit != null && (
                    <Meter label="Compute units used" used={apify.computeUnitsUsed} total={apify.computeUnitsLimit} unit="CU" />
                  )}
                  <ResetLine>Resets {apify.cycleEnd ? `on ${new Date(apify.cycleEnd).toLocaleDateString()}` : 'monthly'} (billing cycle)</ResetLine>
                </>
              )}
            </section>

            {/* GROQ */}
            <section className="uq-card">
              <div className="uq-title">✦ Groq — AI matching</div>
              {!groq?.configured ? (
                <div className="uq-hint">No Groq key set — JD matching uses keyword scoring. Add a key in Tools → API keys for AI ranking.</div>
              ) : groq.limitRequests == null ? (
                <>
                  <Meter label="AI requests today" used={groq.requestsToday} total={null} />
                  <div className="uq-hint">Run a JD match to read your live Groq limits ({groq.model}).</div>
                </>
              ) : (
                <>
                  <Meter
                    label="Requests used (today)"
                    used={groq.limitRequests - groq.remainingRequests}
                    total={groq.limitRequests}
                    note={groq.remainingRequests <= 0 ? 'Daily request limit reached' : `${groq.remainingRequests} left`}
                  />
                  {groq.resetRequests && <ResetLine>Requests reset in {groq.resetRequests}</ResetLine>}
                  {groq.limitTokens != null && (
                    <Meter
                      label="Tokens used (this minute)"
                      used={groq.limitTokens - groq.remainingTokens}
                      total={groq.limitTokens}
                      note={`${Number(groq.remainingTokens).toLocaleString()} left`}
                    />
                  )}
                  {groq.resetTokens && <ResetLine>Tokens reset in {groq.resetTokens}</ResetLine>}
                  <div className="uq-foot">{groq.requestsToday} AI calls so far today · {groq.model}</div>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
