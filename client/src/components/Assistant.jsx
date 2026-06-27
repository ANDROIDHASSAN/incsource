import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useEscapeClose } from '../useEscapeClose.js';

// Map the agent's structured brief onto the sourcing-run request body.
function briefToBody(brief, sources) {
  return {
    sources,
    query: brief.role || '',
    count: Number(brief.count) || 25,
    city: brief.city || '',
    state: brief.state || '',
    country: brief.country || 'India',
    expMin: brief.expMin ?? '',
    expMax: brief.expMax ?? '',
    skills: Array.isArray(brief.skills) ? brief.skills : [],
    openToWorkOnly: brief.openToWork !== false,
    indiaOnly: (brief.country || 'India') === 'India',
    countryOnly: true,
    workMode: brief.workMode || 'any',
    sessionName: [brief.role, brief.city].filter(Boolean).join(' · '),
  };
}

const GREETING = {
  role: 'assistant',
  content: 'Hi! I’m your sourcing assistant. Tell me who you’re looking for — e.g. “I need a React developer in Nashik” — and I’ll handle the rest: I’ll ask a few questions, then find, filter and (if you want) email candidates for you.',
};

export function Assistant({ onClose, toast, sources, onComplete }) {
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState('');
  const [brief, setBrief] = useState(null);
  const [ready, setReady] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [running, setRunning] = useState(false);
  const scrollRef = useRef(null);
  useEscapeClose(running ? () => {} : onClose); // don't let Escape close mid-run

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [messages, thinking]);

  // Append a chat line. `kind`: undefined (normal) | 'action' (agent doing work).
  const push = (role, content, kind) => setMessages((m) => [...m, { role, content, kind }]);

  async function send() {
    const text = input.trim();
    if (!text || thinking || running) return;
    setInput('');
    const next = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setThinking(true);
    try {
      // Send only the plain conversation (omit action lines) to the agent.
      const convo = next.filter((m) => !m.kind).map((m) => ({ role: m.role, content: m.content }));
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

  // The agentic run: chat drives sourcing → (optional) outreach, narrating live.
  async function runTask() {
    if (!brief || running) return;
    setReady(false);
    setRunning(true);
    const body = briefToBody(brief, sources);
    push('action', `🔎 Sourcing ${body.count} ${body.query || 'candidates'}${body.city ? ` in ${body.city}` : ''}…`);

    let run = null;
    let seenKept = 0;
    try {
      await api.runStream(body, (ev) => {
        if (ev.type === 'phase' && ev.message) push('action', `· ${ev.message}`);
        else if (ev.type === 'source' && ev.got != null) push('action', `· ${ev.source}: ${ev.error ? 'failed' : `${ev.got} found`}`);
        else if (ev.type === 'candidates' && ev.kept != null && ev.kept !== seenKept) { seenKept = ev.kept; }
        else if (ev.type === 'done') run = ev.run;
        else if (ev.type === 'error') push('action', `⚠️ ${ev.message}`);
      });
      if (!run) { const s = await api.sessions().catch(() => null); run = s?.runs?.[0] || null; }
    } catch {
      // stream may drop its final chunk; reconcile from the server below
      const s = await api.sessions().catch(() => null);
      run = s?.runs?.[0] || null;
    }

    if (!run || !run.kept) {
      push('assistant', 'I couldn’t find live profiles for that brief — the sources returned nothing (often an Apify quota or a very narrow filter). Try widening the role or location and run again.');
      setRunning(false);
      setReady(true);
      onComplete?.(run);
      return;
    }

    push('action', `✅ Found ${run.kept} candidate${run.kept === 1 ? '' : 's'}${run.strongMatches ? ` · ${run.strongMatches} strong match(es)` : ''}.`);

    // Optional outreach — only those with an email receive it (server enforces the cap).
    if (brief.wantsEmail) {
      try {
        const sess = await api.sessionCandidates(run.id, { limit: 500 });
        const ids = (sess.candidates || []).map((c) => c.id);
        if (ids.length) {
          push('action', `✉️ Emailing ${ids.length} candidate${ids.length === 1 ? '' : 's'}…`);
          const res = await api.campaign({ ids, templateId: brief.emailTemplate || 'intro' });
          push('action', `✅ Sent ${res.sent || 0} · skipped ${res.skipped || 0} (no email)${res.capped ? ` · ${res.capped} held by daily cap` : ''}.`);
        }
      } catch {
        push('action', '⚠️ Couldn’t complete the email step — you can send from the candidate list.');
      }
    }

    push('assistant', `Done! I’ve opened the “${run.name}” session with your candidates. Want to refine the search or start a new one?`);
    setRunning(false);
    onComplete?.(run);
  }

  return (
    <div className="assistant-overlay" onClick={running ? undefined : onClose}>
      <aside className="assistant-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="assistant-head">
          <div className="assistant-title"><span className="assistant-spark">✦</span> Sourcing Assistant</div>
          <button className="modal-close" onClick={onClose} aria-label="Close" disabled={running}>×</button>
        </header>

        <div className="assistant-msgs" ref={scrollRef}>
          {messages.map((m, i) => (
            <div key={i} className={`amsg ${m.role} ${m.kind || ''}`}>{m.content}</div>
          ))}
          {thinking && <div className="amsg assistant typing"><span /><span /><span /></div>}
        </div>

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
            <button className="btn primary full" onClick={runTask}>✦ Run task</button>
          </div>
        )}

        <div className="assistant-input">
          <input
            className="input full"
            placeholder={running ? 'Working…' : 'Message the assistant…'}
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
