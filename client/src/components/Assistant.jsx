import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useEscapeClose } from '../useEscapeClose.js';
import { runErrorMessage } from '../runError.js';

const GREETING = {
  role: 'assistant',
  content: 'Hi! I’m your sourcing assistant. Tell me who you’re looking for — e.g. “I need a React developer in Nashik” — and I’ll handle the rest: I’ll ask a few questions, then find, filter and (if you want) email candidates for you.',
};

// The Sourcing Assistant.
//
// A non-blocking right-side drawer: you chat to build a brief, then hit Run and
// the agent team sources in the background. There is NO takeover/orchestration
// screen — sourced candidates stream straight into your main list, one by one,
// as the agents find them. The drawer just shows the conversation plus a slim
// live-progress strip, so you watch the results fill in while you keep working.
export function Assistant({ onClose, toast, sources, onRunStart, onLive, onComplete }) {
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState('');
  const [brief, setBrief] = useState(null);
  const [ready, setReady] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState(null); // { phase, kept, scanned, total }
  // ── Find-&-email an already-sourced candidate, straight from the drawer ──
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [sendingId, setSendingId] = useState(null);
  const searchTimer = useRef(null);
  const pollRef = useRef(null);
  const scrollRef = useRef(null);
  useEscapeClose(running ? () => {} : searchOpen ? () => setSearchOpen(false) : onClose); // Escape closes search first, never mid-run

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [messages, thinking, live]);
  // Stop polling / pending search if the drawer unmounts — the server-side run continues regardless.
  useEffect(() => () => { clearInterval(pollRef.current); clearTimeout(searchTimer.current); }, []);

  const push = (role, content) => setMessages((m) => [...m, { role, content }]);

  // Debounced pool search: find candidates already in the list by name or skill.
  // Job-leads aren't contactable people, so they're filtered out.
  function onSearchChange(v) {
    setSearchQ(v);
    clearTimeout(searchTimer.current);
    const q = v.trim();
    if (!q) { setResults([]); setSearching(false); return; }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const d = await api.candidates({ q, sort: '-fitScore', limit: 8 });
        setResults((d.candidates || []).filter((c) => c.recordType !== 'job-lead'));
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 280);
  }

  // One-click outreach for a searched candidate: find a verified email if missing,
  // render the intro template, open a pre-filled mail draft, and log the touch.
  async function emailCandidate(c) {
    if (sendingId) return;
    setSendingId(c.id);
    try {
      let person = c;
      if (!person.email) {
        toast?.('Finding a verified email…');
        const res = await api.enrich(c.id).catch(() => ({}));
        if (res.candidate) person = res.candidate;
      }
      if (!person.email) { toast?.(`No email found for ${person.fullName} — open them in the list to reach out`, 'err'); return; }
      const p = await api.outreachPreview(person.id, { templateId: 'intro', role: person.currentTitle || '' });
      window.open(`mailto:${person.email}?subject=${encodeURIComponent(p.subject)}&body=${encodeURIComponent(p.body)}`, '_blank');
      await api.outreachLog(person.id, { channel: 'email', subject: p.subject }).catch(() => {});
      setResults((rs) => rs.map((r) => (r.id === person.id ? person : r)));
      toast?.(`Email drafted to ${person.fullName.split(' ')[0]} · logged as Contacted`, 'ok');
    } catch {
      toast?.('Could not draft the email', 'err');
    } finally {
      setSendingId(null);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || thinking || running) return;
    setInput('');
    const next = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setThinking(true);
    try {
      const convo = next.map((m) => ({ role: m.role, content: m.content }));
      const turn = await api.agentChat(convo);
      if (turn.error) { push('assistant', turn.error); return; }
      push('assistant', turn.reply);
      setBrief(turn.brief || null);
      setReady(Boolean(turn.ready));
    } catch {
      push('assistant', 'Sorry — I had trouble there. Could you say that again?');
    } finally {
      setThinking(false);
    }
  }

  // Launch the background agent team and mirror its LIVE candidate pool into the
  // main list. The run executes server-side (planner → source → critic loop →
  // outreach); we poll its growing pool and forward it to the app so candidates
  // appear in real time.
  async function runTask() {
    if (!brief || running) return;
    setReady(false);
    setRunning(true);
    setLive({ phase: 'Dispatching the agent team…', kept: 0, scanned: 0, total: Number(brief.count) || 0 });
    onRunStart?.(brief);
    push('assistant', `On it — I’m sourcing now. Candidates appear in your list in real time as I find them${brief.wantsEmail ? ', and I’ll email the ones with a verified address' : ''}.`);

    let jobId;
    try {
      const res = await api.agentRun({ brief, sources });
      jobId = res.jobId;
      if (!jobId) throw new Error(res.error || 'Could not start the run');
    } catch (e) {
      push('assistant', `Couldn’t start the run — ${e.message || 'please try again'}.`);
      setRunning(false); setReady(true); setLive(null);
      onComplete?.(null);
      return;
    }

    let finished = false;
    const total = Number(brief.count) || 0;
    const poll = async () => {
      let job;
      try { job = await api.agentJob(jobId); } catch { return; } // transient — keep polling
      if (!job || (!job.status && job.error)) return;
      const working = (job.agents || []).find((a) => a.status === 'working');
      const phase = job.phase || (working ? `${working.name}: ${working.detail || 'working…'}` : 'Working…');
      setLive({ phase, kept: job.kept || 0, scanned: job.scanned || 0, total });
      onLive?.({ candidates: job.candidates, kept: job.kept, scanned: job.scanned, phase: job.phase, sources: job.sources, target: total });
      if (job.status && job.status !== 'running') {
        finished = true;
        clearInterval(pollRef.current); pollRef.current = null;
        finishRun(job);
      }
    };
    await poll();
    if (!finished) pollRef.current = setInterval(poll, 600);
  }

  // Handle a finished job: surface the outcome in chat. The candidates are
  // already in the list (streamed live); onComplete just settles the session.
  function finishRun(job) {
    setRunning(false);
    setLive(null);
    if (job.status === 'error') {
      push('assistant', `The run hit an error: ${job.error || 'unknown'}. You can try again.`);
      setReady(true);
      onComplete?.(null);
      return;
    }
    const run = job.result?.run || null;
    const kept = job.result?.kept ?? run?.kept ?? 0;
    if (!run || !kept) {
      const why = runErrorMessage(run);
      if (why) { push('assistant', `${why} Once that's sorted, hit Run again.`); toast?.(why, 'err', 9000); }
      else push('assistant', `I searched ${run?.location || brief.city || 'there'} but found no exact matches for that brief. Try a nearby city or a broader experience range, then run again.`);
      setReady(true);
      onComplete?.(run);
      return;
    }
    const strong = job.result?.strongMatches ? ` · ${job.result.strongMatches} strong match${job.result.strongMatches === 1 ? '' : 'es'}` : '';
    push('assistant', `Done! I sourced ${kept} candidate${kept === 1 ? '' : 's'}${strong} in ${run.location || brief.city || ''} — they’re all in your list now.${brief.wantsEmail ? ' Personalized outreach was sent to those with an email.' : ''} Want to refine the search or start a new one?`);
    onComplete?.(run);
  }

  return (
    <div className="assistant-overlay">
      <aside className="assistant-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="assistant-head">
          <div className="assistant-title"><span className="assistant-spark">✦</span> Sourcing Assistant</div>
          <div className="assistant-head-actions">
            <button
              className={`assistant-search-btn ${searchOpen ? 'on' : ''}`}
              onClick={() => setSearchOpen((o) => !o)}
              aria-pressed={searchOpen}
              title="Find a candidate and email them"
            >🔍 Find &amp; email</button>
            <button className="modal-close" onClick={onClose} aria-label="Close" disabled={running}>×</button>
          </div>
        </header>

        <div className="assistant-msgs" ref={scrollRef}>
          {messages.map((m, i) => (
            <div key={i} className={`amsg ${m.role}`}>{m.content}</div>
          ))}
          {thinking && <div className="amsg assistant typing"><span /><span /><span /></div>}
        </div>

        {live && <LiveStrip live={live} />}

        {ready && brief && !running && (
          <div className="assistant-plan">
            <div className="aplan-row"><b>{brief.role || 'Candidates'}</b>{brief.city ? ` · ${brief.city}` : ''}{brief.country ? `, ${brief.country}` : ''}</div>
            <div className="aplan-meta">
              {brief.count} candidates
              {brief.expMin != null || brief.expMax != null ? ` · ${brief.expMin ?? 0}–${brief.expMax ?? '∞'} yrs` : ''}
              {brief.openToWork ? ' · open-to-work' : ''}
              {brief.skills?.length ? ` · ${brief.skills.slice(0, 4).join(', ')}` : ''}
              {brief.wantsEmail ? ` · will email (${brief.emailTemplate || 'intro'})` : ''}
            </div>
            <div className="aplan-count">
              <div className="aplan-count-top">
                <label htmlFor="aplan-count-range">How many candidates?</label>
                <b>{Number(brief.count) || 1}</b>
              </div>
              <input
                id="aplan-count-range"
                className="aplan-slider"
                type="range"
                min="1"
                max="50"
                step="1"
                value={Number(brief.count) || 1}
                aria-label="Number of candidates to source"
                onChange={(e) => setBrief((b) => ({ ...b, count: Number(e.target.value) }))}
              />
              <div className="aplan-scale"><span>1</span><span>25</span><span>50</span></div>
            </div>
            <button className="btn primary full" onClick={runTask}>✦ Run — stream candidates to my list</button>
          </div>
        )}

        {searchOpen && (
          <div className="assistant-search">
            <div className="asrch-bar">
              <span className="asrch-ico">🔍</span>
              <input
                className="input full"
                placeholder="Search a candidate by name, skill or company…"
                value={searchQ}
                autoFocus
                onChange={(e) => onSearchChange(e.target.value)}
              />
              <button className="modal-close" onClick={() => setSearchOpen(false)} aria-label="Close search">×</button>
            </div>
            <div className="asrch-results">
              {searching && <div className="asrch-note">Searching…</div>}
              {!searching && searchQ.trim() && !results.length && (
                <div className="asrch-note">No candidates match “{searchQ.trim()}”. Source some first, or try another name.</div>
              )}
              {!searchQ.trim() && !results.length && (
                <div className="asrch-note">Type a name to find an already-sourced candidate, then email them in one click.</div>
              )}
              {results.map((c) => (
                <div key={c.id} className="asrch-row">
                  <div className="asrch-info">
                    <div className="asrch-name">
                      {c.fullName}
                      {c.openToWork && <span className="asrch-tag otw">open</span>}
                      {!c.email && <span className="asrch-tag noemail">no email yet</span>}
                    </div>
                    <div className="asrch-sub">{[c.currentTitle, c.city].filter(Boolean).join(' · ') || '—'}</div>
                  </div>
                  <button
                    className="btn sm primary"
                    disabled={sendingId === c.id}
                    onClick={() => emailCandidate(c)}
                  >
                    {sendingId === c.id ? '…' : c.email ? '✉ Email' : '✉ Find & email'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="assistant-input">
          <input
            className="input full"
            placeholder={running ? 'Sourcing… results are streaming into your list' : 'Message the assistant…'}
            value={input}
            disabled={running}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          />
          <button className="btn primary" onClick={send} disabled={thinking || running || !input.trim()}>Send</button>
        </div>
      </aside>
    </div>
  );
}

// Slim, premium live-progress strip — the ONLY status UI. No takeover screen:
// the real output is the candidate list filling up behind/beside the drawer.
function LiveStrip({ live }) {
  const pct = live.total
    ? Math.min(100, Math.round((live.kept / live.total) * 100))
    : live.kept ? Math.min(90, 24 + live.kept * 6) : 10;
  return (
    <div className="live-strip" role="status" aria-live="polite">
      <div className="live-top">
        <span className="live-orb" />
        <span className="live-label">{live.phase}</span>
        <span className="live-count">{live.kept}{live.total ? ` / ${live.total}` : ''} found</span>
      </div>
      <div className="live-bar"><span className="live-fill" style={{ width: `${pct}%` }} /></div>
      <div className="live-sub">
        {live.scanned > 0 ? `Scanned ${live.scanned} profiles · ` : ''}results streaming into your list →
      </div>
    </div>
  );
}
