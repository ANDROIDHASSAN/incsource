import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { CandidateCard } from './components/CandidateCard.jsx';
import { CandidateModal } from './components/CandidateModal.jsx';
import { FilterPanel } from './components/FilterPanel.jsx';
import { Analytics } from './components/Analytics.jsx';
import { Segments } from './components/Segments.jsx';
import { BulkBar } from './components/BulkBar.jsx';
import { Toasts } from './components/Toasts.jsx';
import { JDMatch } from './components/JDMatch.jsx';
import { TemplateManager } from './components/TemplateManager.jsx';
import { CampaignModal } from './components/CampaignModal.jsx';
import { SessionsMenu } from './components/SessionsMenu.jsx';
import { SourcingBrief } from './components/SourcingBrief.jsx';
import { Settings } from './components/Settings.jsx';
import { Usage } from './components/Usage.jsx';

const initials = (u) => {
  const base = (u?.name || u?.email || '?').trim();
  const parts = base.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
};

const SOURCE_META = {
  inbound: { dot: '#18ac00', label: 'Inbound' },
  'linkedin-harvest': { dot: '#133f7a', label: 'LinkedIn·Harvest' },
  'apify-linkedin': { dot: '#12b6bc', label: 'LinkedIn' },
  'indeed-resume': { dot: '#e8aa4e', label: 'Indeed' },
  'apify-naukri': { dot: '#626262', label: 'Naukri' },
  'naukri-jobs': { dot: '#f2464b', label: 'Naukri·Jobs' },
};

const SUITE = [
  { name: 'IncServe', desc: 'Interview as a Service' },
  { name: 'IncBot', desc: 'AI Interview Software' },
  { name: 'IncScreen', desc: 'AI Phone Screening' },
  { name: 'IncVid', desc: 'Video Interview' },
  { name: 'IncFeed', desc: 'Interview Scheduling' },
  { name: 'IncProctor', desc: 'AI Proctoring' },
  { name: 'IncSource', desc: 'Active Talent Sourcing', current: true },
];

const EMPTY_FILTERS = {
  q: '', sort: '-fitScore', band: '', minScore: 0, region: '', states: [], cities: [],
  sources: [], skills: [], skillsMatch: 'any', status: [], starred: false, openToWork: false,
  indiaOnly: false, hasEmail: false, noticeMaxDays: '', includeLeads: false,
  expMin: '', expMax: '', workMode: '',
};

// Turn a run's raw source errors into one clear, actionable sentence. The most
// common real-world failure is the Apify account hitting its monthly spend cap —
// which 403s every actor, so the run returns 0 and looks (wrongly) like "no
// candidates exist". Name the real cause so the recruiter knows what to do.
function runErrorMessage(run) {
  const errs = run?.errors || [];
  if (!errs.length) return null;
  const txt = errs.map((e) => e.message || '').join(' · ');
  if (/monthly usage hard limit|platform-feature-disabled|usage hard limit exceeded/i.test(txt))
    return 'Apify monthly usage limit reached — live scraping is paused. Upgrade your Apify plan or add an API token with remaining quota in Tools → API keys (or wait for your Apify billing cycle to reset).';
  if (/\b401\b|invalid token|authderation|authentication|not authorized|unauthorized/i.test(txt))
    return 'Apify token was rejected — check or replace your API key in Tools → API keys.';
  if (/\b402\b|payment required|insufficient/i.test(txt))
    return 'Apify reported insufficient credit — top up or upgrade your Apify plan to resume live scraping.';
  if (/timed out|exceeded \d+s/i.test(txt))
    return 'Sources timed out before returning profiles — try again, or search a simpler role/location.';
  return `Sources errored (${errs.map((e) => e.source).join(', ')}): ${txt.slice(0, 160)}`;
}

function toParams(f) {
  const p = {};
  if (f.q) p.q = f.q;
  if (f.sort) p.sort = f.sort;
  if (f.band) p.band = f.band;
  if (f.minScore > 0) p.minScore = f.minScore;
  if (f.region) p.region = f.region;
  if (f.states.length) p.states = f.states.join(',');
  if (f.cities.length) p.cities = f.cities.join(',');
  if (f.sources.length) p.sources = f.sources.join(',');
  if (f.skills.length) { p.skills = f.skills.join(','); p.skillsMatch = f.skillsMatch; }
  if (f.status?.length) p.status = f.status.join(',');
  if (f.starred) p.starred = true;
  if (f.openToWork) p.openToWork = true;
  if (f.indiaOnly) p.indiaOnly = true;
  if (f.hasEmail) p.hasEmail = true;
  if (f.noticeMaxDays) p.noticeMaxDays = f.noticeMaxDays;
  if (f.includeLeads) p.includeLeads = true;
  if (f.expMin !== '' && f.expMin != null) p.expMin = f.expMin;
  if (f.expMax !== '' && f.expMax != null) p.expMax = f.expMax;
  if (f.workMode) p.workMode = f.workMode;
  return p;
}

export default function App({ user, onLogout }) {
  const [providers, setProviders] = useState([]);
  // Default to the fast, reliable sources. Indeed's actor routinely times out (~70s
  // for ~0 results), so it's off by default — toggle it on at left if you want it.
  const [selected, setSelected] = useState(['inbound', 'linkedin-harvest', 'apify-linkedin']);
  const [enriching, setEnriching] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  // Fresh "new session" canvas — shows an empty pool until you run a search,
  // so each session starts clean (ChatGPT-style new chat).
  const [freshSession, setFreshSession] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null); // live sourcing progress
  const [lastRun, setLastRun] = useState(null);
  const [apifyMode, setApifyMode] = useState('mock');

  const [candidates, setCandidates] = useState([]);
  const [total, setTotal] = useState(0);
  const [pageLimit, setPageLimit] = useState(50);
  const [stats, setStats] = useState({ total: 0, openToWork: 0, hot: 0, shortlisted: 0 });
  const [analytics, setAnalytics] = useState(null);
  const [facets, setFacets] = useState({ states: [], cities: [], sources: [], skills: [] });
  const [geo, setGeo] = useState({ states: [], zones: [], metros: [] });
  const [meta, setMeta] = useState({ stages: [], templates: [] });
  const [templates, setTemplates] = useState([]);
  const [emailMode, setEmailMode] = useState(null);
  const [segments, setSegments] = useState([]);

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const setF = (patch) => setFilters((prev) => ({ ...prev, ...patch }));

  const [selectedIds, setSelectedIds] = useState([]);
  const [modalC, setModalC] = useState(null);
  const [jdOpen, setJdOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [aiOn, setAiOn] = useState(false);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [suiteOpen, setSuiteOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [runError, setRunError] = useState(null); // persistent banner when a run can't source
  const toastSeq = useRef(0);

  const toast = (msg, kind, ttl = 2600) => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttl);
  };

  useEffect(() => {
    api.providers().then((d) => setProviders(d.providers || []));
    api.health().then((d) => { setApifyMode(d.apify); setAiOn(Boolean(d.ai)); });
    api.geo().then(setGeo);
    api.meta().then(setMeta);
    api.segments().then((d) => setSegments(d.segments || []));
    loadTemplates();
    loadSessions();
    api.emailStatus().then((d) => setEmailMode(d.mode));
  }, []);

  const loadTemplates = () => api.templates().then((d) => setTemplates(d.templates || []));
  const loadSessions = () => api.sessions().then((d) => setSessions(d.runs || []));

  function refreshData() {
    const params = toParams(filters);
    if (running) {
      // A sourcing run is streaming its own results into the list — never overwrite
      // it with the global pool (that's what leaked old candidates into a new session).
    } else if (freshSession && !activeSession) {
      // Empty canvas for a brand-new session — wait for the user to run a search.
      setCandidates([]); setTotal(0);
    } else {
      // When a session is active, the candidate list is scoped to that session's snapshot.
      const listP = activeSession
        ? api.sessionCandidates(activeSession.id, { ...params, limit: pageLimit })
        : api.candidates({ ...params, limit: pageLimit, offset: 0 });
      listP.then((d) => { setCandidates(d.candidates || []); setTotal(d.total || 0); });
    }
    api.stats().then(setStats);
    api.analytics(params).then(setAnalytics);
    api.facets().then(setFacets);
  }

  useEffect(() => {
    const t = setTimeout(refreshData, 180);
    return () => clearTimeout(t);
  }, [filters, pageLimit, activeSession, freshSession, running]);

  async function handleRun(brief) {
    if (!selected.length) { toast('Pick at least one source at left', 'err'); return; }
    setRunError(null);
    setFreshSession(false);
    setRunning(true);
    setProgress({ phase: 'Starting…', scanned: 0, kept: 0, target: Number(brief.count) || 0, sources: {} });
    setCandidates([]);
    try {
      // Search providers by ROLE only — jamming skills into the job-title query
      // over-narrows LinkedIn/Indeed actors and returns almost nothing. Skills
      // are used for ranking/filtering, not to constrain the source search.
      const effectiveQuery = brief.query.trim() || brief.skills.slice(0, 2).join(' ');
      const body = {
        sources: selected, query: effectiveQuery, location: brief.location,
        city: brief.city, state: brief.state, country: brief.country,
        expMin: brief.expMin, expMax: brief.expMax, skills: brief.skills, jd: brief.jd,
        openToWorkOnly: brief.openToWorkOnly, indiaOnly: brief.indiaOnly,
        workMode: brief.workMode || 'any',
        findContacts: brief.findContacts, sessionName: brief.sessionName,
        customActor: brief.customActor || '',
        count: Number(brief.count), limit: Number(brief.limit),
      };

      let done = null;
      let streamErr = null;
      try {
        await api.runStream(body, (ev) => {
          if (ev.type === 'phase') {
            setProgress((p) => ({ ...p, phase: ev.message, ...(ev.scanned != null ? { scanned: ev.scanned } : {}) }));
          } else if (ev.type === 'source') {
            setProgress((p) => ({ ...p, sources: { ...p.sources, [ev.source]: ev.error ? 'err' : ev.got } }));
            if (ev.error) {
              const label = (SOURCE_META[ev.source] || {}).label || ev.source.replace('custom:', '');
              toast(`${label}: ${String(ev.error).slice(0, 90)}`, 'err');
            }
          } else if (ev.type === 'candidates') {
            setProgress((p) => ({ ...p, kept: ev.kept, scanned: ev.scanned ?? p.scanned }));
            setCandidates(ev.candidates || []);
            setTotal((ev.candidates || []).length);
          } else if (ev.type === 'done') {
            done = ev;
          } else if (ev.type === 'error') {
            streamErr = ev.message;
          }
        });
      } catch (e) {
        // The dev proxy can buffer/drop the final stream chunk — don't fail the run
        // on that. We reconcile from the server below (the run is saved regardless).
        streamErr = streamErr || e.message;
      }

      setFreshSession(false);
      // Reconcile from the server: the run is persisted server-side even if the
      // stream didn't deliver its final 'done'. Activate the newest session so the
      // view scopes to THIS run's candidates instead of the whole pool.
      let run = done?.run || null;
      if (!run) {
        const sess = await api.sessions().catch(() => null);
        run = sess?.runs?.[0] || null;
      }
      loadSessions();
      if (run) {
        setLastRun(run);
        // Do NOT re-apply a STRICT experience band to the session view. Sourcing
        // already filtered with a LENIENT band — it deliberately keeps band-edge
        // people (e.g. a 4–5y dev for a "Junior 0–3" brief when a strict cut would
        // return nobody in that city). Re-imposing a hard expMin/expMax here would
        // hide the very candidates the run just found, leaving the recruiter on an
        // empty "0 candidates" session. Clear it so the session shows everything it
        // sourced; the recruiter can still narrow via the filter panel.
        setFilters((f) => ({ ...f, expMin: '', expMax: '' }));
        setActiveSession(run); // effect loads this session's scoped candidates
        const ct = run.contacts;
        if (run.customActorInvalid) toast("Couldn't read that Apify actor link — check the URL/id", 'err');
        const widened = run.relaxNotes?.length ? ` · widened ${run.relaxNotes.join(', ')} to reach your count` : '';
        const strong = run.strongMatches ? ` · ${run.strongMatches} strong JD match${run.strongMatches === 1 ? '' : 'es'} (70+)` : '';
        const errMsg = runErrorMessage(run);
        if (run.kept === 0 && errMsg) {
          // Sources couldn't return anything (e.g. Apify quota) — show the real reason
          // in a persistent banner + a longer toast, not the misleading "all profiles".
          setRunError(errMsg);
          toast(errMsg, 'err', 9000);
        } else if (run.shortOfTarget > 0) {
          setRunError(errMsg);
          toast(`Found ${run.kept} of ${run.requestedCount}${strong} — ${errMsg || "that's all the live profiles your sources returned."}`, 'err', errMsg ? 9000 : 2600);
        } else {
          setRunError(null);
          toast(`Pulled ${run.kept} candidate${run.kept === 1 ? '' : 's'}${strong}${widened}${ct ? ` · ${ct.withEmail} emails found` : ''}`, 'ok');
        }
      } else {
        const msg = streamErr || 'Sourcing failed — check sources';
        setRunError(msg);
        toast(msg, 'err', 9000);
      }
      api.stats().then(setStats);
      api.analytics(toParams(filters)).then(setAnalytics);
      api.facets().then(setFacets);
    } catch (e) {
      toast(e.message || 'Sourcing failed', 'err');
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  const toggleSource = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  // patch one candidate everywhere it appears
  function applyUpdate(updated) {
    setCandidates((cs) => cs.map((c) => (c.id === updated.id ? updated : c)));
    setModalC((m) => (m && m.id === updated.id ? updated : m));
    api.stats().then(setStats);
    api.analytics(toParams(filters)).then(setAnalytics);
  }

  async function quickStar(c) {
    const updated = await api.patch(c.id, { starred: !c.starred });
    applyUpdate(updated);
    toast(updated.starred ? 'Added to shortlist' : 'Removed from shortlist');
  }

  // ── One-click contact ───────────────────────────────────────────────
  // If we have an email: render the default template, open the user's mail app
  // with it pre-filled, and log the touch — all in a single click.
  async function quickContact(c) {
    if (!c.email) return quickFindEmail(c, true);
    try {
      const p = await api.outreachPreview(c.id, { templateId: 'intro', role: c.currentTitle || '' });
      window.open(`mailto:${c.email}?subject=${encodeURIComponent(p.subject)}&body=${encodeURIComponent(p.body)}`, '_blank');
      const updated = await api.outreachLog(c.id, { channel: 'email', subject: p.subject });
      applyUpdate(updated);
      toast(`Email drafted to ${c.fullName.split(' ')[0]} · logged as Contacted`, 'ok');
    } catch {
      toast('Could not open the email draft', 'err');
    }
  }

  // No email yet → find one (premium). Optionally chain straight into contact.
  async function quickFindEmail(c, thenContact = false) {
    toast('Finding a verified email…');
    try {
      const res = await api.enrich(c.id);
      if (res.error) return toast(res.error, 'err');
      if (res.candidate) applyUpdate(res.candidate);
      if (res.found?.email) {
        toast('Email found ✓', 'ok');
        if (thenContact && res.candidate) quickContact(res.candidate);
      } else {
        toast('No email found — open the profile to reach out', 'err');
      }
    } catch {
      toast('Find-email failed', 'err');
    }
  }

  async function handleDelete(id) {
    await api.remove(id);
    setModalC(null);
    setSelectedIds((s) => s.filter((x) => x !== id));
    toast('Candidate deleted');
    refreshData();
  }

  // selection / bulk
  const toggleSelect = (id) => setSelectedIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const clearSel = () => setSelectedIds([]);
  // Select-all (real candidates only — job-leads aren't contactable people).
  const selectableIds = candidates.filter((c) => c.recordType !== 'job-lead').map((c) => c.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.includes(id));
  const toggleSelectAll = () => setSelectedIds(allSelected ? [] : selectableIds);
  async function bulkStatus(status) {
    await api.bulk({ ids: selectedIds, patch: { status } });
    toast(`${selectedIds.length} moved to ${status}`);
    clearSel(); refreshData();
  }
  async function bulkStar() {
    await api.bulk({ ids: selectedIds, patch: { starred: true } });
    toast(`${selectedIds.length} shortlisted`);
    clearSel(); refreshData();
  }
  async function bulkEnrich() {
    setEnriching(true);
    try {
      const res = await api.enrichBulk(selectedIds);
      if (res.error) { toast(res.error, 'err'); return; }
      toast(`Found ${res.withEmail} emails`, 'ok');
      clearSel(); refreshData();
    } finally {
      setEnriching(false);
    }
  }
  async function bulkDelete() {
    await api.bulk({ ids: selectedIds, delete: true });
    toast(`${selectedIds.length} deleted`);
    clearSel(); refreshData();
  }
  function exportCsv(ids) {
    // Bulk-bar export sends the selected ids; the Tools menu exports the filtered set.
    const params = ids && ids.length ? { ids: ids.join(',') } : toParams(filters);
    api.downloadExport(params)
      .then(() => toast('Export downloaded'))
      .catch(() => toast('Export failed', 'err'));
  }

  // segments
  async function saveSegment() {
    const name = window.prompt('Name this saved search:');
    if (!name) return;
    const seg = await api.saveSegment({ name, filters });
    setSegments((s) => [seg, ...s]);
    toast('Saved search created');
  }
  function applySegment(seg) {
    setFilters({ ...EMPTY_FILTERS, ...seg.filters });
    toast(`Applied “${seg.name}”`);
  }
  async function deleteSegment(id) {
    await api.deleteSegment(id);
    setSegments((s) => s.filter((x) => x.id !== id));
  }

  // sessions (ChatGPT-style: each search is a session with its own candidate history)
  function newSession() {
    setActiveSession(null);
    setFreshSession(true);
    setFilters(EMPTY_FILTERS);
    setCandidates([]); setTotal(0);
    setLastRun(null);
    clearSel();
    toast('New session — set your brief at left and run sourcing');
  }
  function openSession(s) { setFreshSession(false); setActiveSession(s); toast(`Opened “${s.name}”`); }
  function exitSession() { setFreshSession(false); setActiveSession(null); }
  async function renameSession(s) {
    const name = window.prompt('Rename session:', s.name);
    if (!name || name === s.name) return;
    await api.renameSession(s.id, name);
    loadSessions();
    if (activeSession?.id === s.id) setActiveSession({ ...activeSession, name });
    toast('Session renamed');
  }
  async function deleteSession(s) {
    if (!window.confirm(`Delete session “${s.name}”? (Candidates are kept.)`)) return;
    await api.deleteSession(s.id);
    if (activeSession?.id === s.id) setActiveSession(null);
    loadSessions();
    toast('Session deleted');
  }

  const filtersActive = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

  // Dashboard stats follow the current context: a brand-new session shows zeros,
  // an open/just-run session shows ITS pulled candidates, otherwise the whole pool.
  const sessionView = Boolean(activeSession) || freshSession || running;
  const viewStats = !sessionView
    ? stats
    : {
        total: activeSession ? total : candidates.length,
        openToWork: candidates.filter((c) => c.openToWork).length,
        hot: candidates.filter((c) => (c.activeScore || 0) >= 70).length,
        shortlisted: candidates.filter((c) => c.starred).length,
      };
  const sessionLabel = activeSession?.name || (freshSession ? 'New session' : null);

  return (
    <div className="shell">
      {/* ── App bar with product switcher ── */}
      <nav className="appbar">
        <div className="appbar-left">
          <div className="suite" onClick={() => setSuiteOpen((o) => !o)}>
            <div className="brand-logo">in</div>
            <div className="suite-name">IncSource <span className="chev">▾</span></div>
            {suiteOpen && (
              <div className="suite-menu" onClick={(e) => e.stopPropagation()}>
                <div className="suite-head">InCruiter suite</div>
                {SUITE.map((p) => (
                  <div key={p.name} className={`suite-item ${p.current ? 'cur' : ''}`}>
                    <span className="suite-item-name">{p.name}{p.current && <span className="here">●</span>}</span>
                    <span className="suite-item-desc">{p.desc}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <span className="appbar-div" />
          <span className="appbar-tag">Active Talent Sourcing</span>
        </div>
        <div className="appbar-right">
          <SessionsMenu sessions={sessions} active={activeSession} onNew={newSession} onOpen={openSession} onExit={exitSession} onRename={renameSession} onDelete={deleteSession} />
          <button className="btn sm primary jd-btn" onClick={() => setJdOpen(true)}>✦ Match to JD</button>
          {/* Secondary tools tucked under one menu to keep the bar clean */}
          <div className="tools" onClick={() => setToolsOpen((o) => !o)}>
            <button className="btn sm">⋯ Tools <span className="chev">▾</span></button>
            {toolsOpen && (
              <div className="tools-menu" onClick={(e) => e.stopPropagation()}>
                <button className="tools-item" onClick={() => { setSettingsOpen(true); setToolsOpen(false); }}>🔑 API keys</button>
                <button className="tools-item" onClick={() => { setTplOpen(true); setToolsOpen(false); }}>✉ Email templates</button>
                <button className="tools-item" onClick={() => { exportCsv(); setToolsOpen(false); }}>↓ Export CSV</button>
              </div>
            )}
          </div>
          <button className={`mode-chip ${aiOn ? 'live' : 'mock'}`} onClick={() => setSettingsOpen(true)} title="Add your Groq API key to enable AI matching">
            <span className="dot" />{aiOn ? 'AI: on' : 'AI: add key'}
          </button>
          {emailMode === 'test' && <div className="mode-chip mock" title="Add SMTP_HOST in server/.env to send for real"><span className="dot" />Email: test inbox</div>}
          <div className={`mode-chip ${apifyMode}`}><span className="dot" />{apifyMode === 'live' ? 'Live data' : 'Sample data'}</div>
          <button className="mode-chip usage-chip" onClick={() => setUsageOpen(true)} title="Email, Apify & Groq usage vs. limits">📊 Usage</button>
          {user && (
            <div className="tools account" onClick={() => setAccountOpen((o) => !o)}>
              <button className="avatar-btn" title={user.email}>{initials(user)}</button>
              {accountOpen && (
                <div className="tools-menu account-menu" onClick={(e) => e.stopPropagation()}>
                  <div className="account-head">
                    <div className="account-name">{user.name || user.email}</div>
                    <div className="account-email">{user.email}</div>
                    {user.company && <div className="account-co">{user.company}</div>}
                  </div>
                  <button className="tools-item danger" onClick={() => { setAccountOpen(false); onLogout(); }}>↪ Sign out</button>
                </div>
              )}
            </div>
          )}
        </div>
      </nav>

      <div className="app">
        {/* ── Sidebar ── */}
        <aside className="sidebar">
          <div className="side-label">Sources</div>
          {providers.map((p) => {
            const m = SOURCE_META[p.id] || { dot: '#626262', label: p.label };
            const on = selected.includes(p.id);
            return (
              <button key={p.id} className={`src ${on ? 'on' : ''}`} onClick={() => toggleSource(p.id)}>
                <span className="src-mark" style={on ? { background: m.dot } : undefined} />
                <span className="src-name">{p.label}</span>
                <span className="src-state">{p.live ? 'live' : p.compliance === 'owned' ? 'owned' : 'mock'}</span>
              </button>
            );
          })}

          <SourcingBrief
            geo={geo}
            experienceBands={meta.experienceBands}
            running={running}
            lastRun={lastRun}
            onRun={handleRun}
            toast={toast}
          />
        </aside>

        {/* ── Main ── */}
        <main className="main">
          <header className="topbar">
            <div>
              <h1>{sessionLabel || 'Active Candidates'}</h1>
              <p className="sub">
                {sessionView
                  ? `${viewStats.total} candidate${viewStats.total === 1 ? '' : 's'} in this session · its own history`
                  : 'Ranked by active-intent signal · ready to source & outreach.'}
              </p>
            </div>
          </header>

          <div className="stat-cards">
            <StatCard cls="blue" value={viewStats.total} label={sessionView ? 'Pulled this session' : 'Candidates in pool'} ico="◷" />
            <StatCard cls="green" value={viewStats.openToWork} label="Open to work" ico="✓" />
            <StatCard cls="red" value={viewStats.hot} label="Hot · score 70+" ico="✦" />
            <StatCard cls="teal" value={viewStats.shortlisted} label="Shortlisted" ico="★" />
          </div>

          <Analytics data={analytics} />

          <Segments segments={segments} onApply={applySegment} onSave={saveSegment} onDelete={deleteSegment} activeCount={filtersActive ? 1 : 0} />

          <FilterPanel filters={filters} set={setF} facets={facets} geo={geo} stages={meta.stages} count={total} onClear={() => setFilters(EMPTY_FILTERS)} />

          {activeSession && (
            <div className="session-banner">
              <span>🗂 Viewing session <b>{activeSession.name}</b> · {total} candidates</span>
              <button className="link-btn" onClick={exitSession}>← Back to all candidates</button>
            </div>
          )}

          {runError && (
            <div className="run-error-banner">
              <span className="reb-ico">⚠</span>
              <span className="reb-msg">{runError}</span>
              <button className="reb-key" onClick={() => { setSettingsOpen(true); setRunError(null); }}>API keys</button>
              <button className="reb-x" onClick={() => setRunError(null)} aria-label="Dismiss">×</button>
            </div>
          )}

          <div className="list-head">
            <span>Candidates</span>
            <div className="list-head-right">
              {candidates.length > 0 && (
                <button className="link-btn" onClick={toggleSelectAll}>
                  {allSelected ? 'Clear selection' : `Select all ${selectableIds.length}`}
                </button>
              )}
              <span>{candidates.length}{total > candidates.length ? ` of ${total}` : ''} shown</span>
            </div>
          </div>

          <BulkBar
            count={selectedIds.length}
            stages={meta.stages}
            onStatus={bulkStatus}
            onStar={bulkStar}
            onEnrich={bulkEnrich}
            onEmail={() => setCampaignOpen(true)}
            enriching={enriching}
            onExport={() => exportCsv(selectedIds)}
            onDelete={bulkDelete}
            onClear={clearSel}
          />

          {running && progress && (
            <SourcingProgress progress={progress} providers={providers} selected={selected} sourceMeta={SOURCE_META} />
          )}

          <section className="cards">
            {candidates.length === 0 ? (
              running ? (
                <div className="skeleton-cards">
                  {[0, 1, 2].map((i) => <div key={i} className="skeleton-card" style={{ animationDelay: `${i * 120}ms` }} />)}
                </div>
              ) : (
                <div className="empty">
                  <div className="empty-mark">i</div>
                  <h3>No candidates match</h3>
                  <p>Adjust the filters above, or pick sources at left and run a sourcing pass.</p>
                </div>
              )
            ) : (
              candidates.map((c, i) => (
                <CandidateCard
                  key={c.id} c={c} index={i} sourceMeta={SOURCE_META}
                  selected={selectedIds.includes(c.id)} onToggleSelect={toggleSelect}
                  onOpen={setModalC} onStar={quickStar}
                  onContact={quickContact} onFindEmail={quickFindEmail}
                />
              ))
            )}
          </section>

          {total > candidates.length && (
            <button className="load-more" onClick={() => setPageLimit((l) => Math.min(l + 50, 500))}>
              Load more ({total - candidates.length} remaining)
            </button>
          )}
        </main>
      </div>

      {modalC && (
        <CandidateModal
          candidate={modalC} meta={meta} templates={templates} sourceMeta={SOURCE_META}
          onUpdate={applyUpdate} onClose={() => setModalC(null)} onDelete={handleDelete} toast={toast}
        />
      )}
      {settingsOpen && (
        <Settings onClose={() => setSettingsOpen(false)} onSaved={(s) => setAiOn(Boolean(s.ai))} toast={toast} />
      )}
      {usageOpen && <Usage onClose={() => setUsageOpen(false)} toast={toast} />}
      {tplOpen && (
        <TemplateManager templates={templates} onChange={loadTemplates} onClose={() => setTplOpen(false)} toast={toast} />
      )}
      {campaignOpen && (
        <CampaignModal ids={selectedIds} templates={templates} onClose={() => setCampaignOpen(false)} onDone={() => { clearSel(); refreshData(); }} toast={toast} />
      )}
      {jdOpen && (
        <JDMatch
          providers={providers}
          onClose={() => setJdOpen(false)}
          onOpenCandidate={(c) => { setJdOpen(false); setModalC(c); }}
          toast={toast}
        />
      )}
      <Toasts toasts={toasts} />
    </div>
  );
}

function SourcingProgress({ progress, providers, selected, sourceMeta }) {
  const { phase, scanned = 0, kept = 0, target = 0, sources = {} } = progress;
  const pct = target ? Math.min(100, Math.round((kept / target) * 100)) : kept ? 60 : 8;
  const srcList = providers.filter((p) => selected.includes(p.id));
  // Include any source that reported in but isn't a known provider (e.g. custom Apify actor).
  const extra = Object.keys(sources)
    .filter((id) => !srcList.some((p) => p.id === id))
    .map((id) => ({ id, label: id.startsWith('custom:') ? `Apify · ${id.split('/').pop()}` : id }));
  const allSrc = [...srcList, ...extra];
  return (
    <div className="sourcing-progress">
      <div className="sp-top">
        <span className="spinner sm" />
        <span className="sp-msg">{phase}</span>
        <span className="sp-count">{kept}{target ? <span className="sp-of"> / {target}</span> : ''} found</span>
      </div>
      <div className="sp-bar"><span className="sp-bar-fill" style={{ width: `${pct}%` }} /></div>
      <div className="sp-meta">
        {allSrc.map((p) => {
          const v = sources[p.id];
          const label = (sourceMeta[p.id] || {}).label || p.label;
          const cls = v === 'err' ? 'err' : v != null ? 'ok' : 'wait';
          return (
            <span key={p.id} className={`sp-src ${cls}`}>
              {cls === 'ok' ? '✓' : cls === 'err' ? '✕' : '○'} {label}
              {typeof v === 'number' ? ` · ${v}` : v === 'err' ? ' · failed' : ''}
            </span>
          );
        })}
        <span className="sp-scanned">Scanned {scanned} profiles</span>
      </div>
    </div>
  );
}

function StatCard({ cls, value, label, ico }) {
  return (
    <div className={`stat-card ${cls}`}>
      <div className="stat-top"><div className="stat-value">{value}</div><div className="stat-ico">{ico}</div></div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
