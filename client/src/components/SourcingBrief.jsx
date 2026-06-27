import { useMemo, useState } from 'react';
import { api } from '../api.js';

// Countries we source for (recruiter picks one). India default; works worldwide.
const COUNTRIES = [
  'India', 'United States', 'United Kingdom', 'United Arab Emirates', 'Singapore',
  'Canada', 'Australia', 'Germany', 'Netherlands', 'Ireland', 'Saudi Arabia', 'France',
  'Anywhere',
];

// Fallback bands if the server hasn't supplied them yet.
const FALLBACK_BANDS = [
  { key: 'fresher', label: 'Fresher', min: 0, max: 1 },
  { key: '1-3', label: '1–3y', min: 1, max: 3 },
  { key: '3-5', label: '3–5y', min: 3, max: 5 },
  { key: '5-8', label: '5–8y', min: 5, max: 8 },
  { key: '8-12', label: '8–12y', min: 8, max: 12 },
  { key: '12+', label: '12y+', min: 12, max: null },
];

/**
 * The recruiter's "sourcing brief": paste/upload a JD (and auto-fill the brief
 * from it), pin the exact role, skills, location (city · state · country) and
 * experience window, then run the sourcing pass. Everything a recruiter needs to
 * pull the right people lives here.
 */
export function SourcingBrief({
  geo = { states: [], zones: [], metros: [] },
  experienceBands,
  running,
  lastRun,
  onRun,
  toast,
}) {
  const bands = experienceBands?.length ? experienceBands.map(shortLabel) : FALLBACK_BANDS;

  // ── Job description ──────────────────────────────────────────
  const [jdOpen, setJdOpen] = useState(false);
  const [jd, setJd] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(null);

  // ── Role + skills ────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [skills, setSkills] = useState([]);
  const [skillInput, setSkillInput] = useState('');

  // ── Location ─────────────────────────────────────────────────
  const [country, setCountry] = useState('India');
  const [stateSel, setStateSel] = useState('');
  const [city, setCity] = useState('');

  // ── Experience ───────────────────────────────────────────────
  const [band, setBand] = useState('');
  const [expMin, setExpMin] = useState('');
  const [expMax, setExpMax] = useState('');

  // ── Work mode ────────────────────────────────────────────────
  const [workMode, setWorkMode] = useState('any');

  // ── Run options ──────────────────────────────────────────────
  const [openToWorkOnly, setOpenToWorkOnly] = useState(true);
  const [countryOnly, setCountryOnly] = useState(true); // "only in this country"
  const [findContacts, setFindContacts] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const [limit, setLimit] = useState(25);
  const [customActor, setCustomActor] = useState('');
  const [advOpen, setAdvOpen] = useState(false);

  // State dropdown grouped by zone; cities suggested from the chosen state.
  const statesByZone = useMemo(() => {
    return (geo.states || []).reduce((acc, s) => {
      (acc[s.zone || 'Other'] ||= []).push(s);
      return acc;
    }, {});
  }, [geo.states]);

  const cityOptions = useMemo(() => {
    const st = (geo.states || []).find((s) => s.name === stateSel);
    return st?.cities?.length ? st.cities : geo.metros || [];
  }, [geo, stateSel]);

  // ── Skills add / remove ──────────────────────────────────────
  const addSkill = (raw) => {
    const t = (raw || '').trim().replace(/,$/, '');
    if (!t) return;
    setSkills((s) => (s.some((x) => x.toLowerCase() === t.toLowerCase()) ? s : [...s, t]));
    setSkillInput('');
  };
  const removeSkill = (t) => setSkills((s) => s.filter((x) => x !== t));

  // ── Experience band selection ────────────────────────────────
  const pickBand = (b) => {
    if (band === b.key) { setBand(''); setExpMin(''); setExpMax(''); return; }
    setBand(b.key);
    setExpMin(b.min ?? '');
    setExpMax(b.max ?? '');
  };
  const onExpInput = (which, val) => {
    setBand(''); // custom typing clears the preset highlight
    const v = val.replace(/[^0-9]/g, '');
    which === 'min' ? setExpMin(v) : setExpMax(v);
  };

  // ── JD: file upload + auto-fill ──────────────────────────────
  async function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = '';
    setJdOpen(true);
    const name = f.name.toLowerCase();
    // Plain text reads instantly in the browser…
    if (name.endsWith('.txt') || name.endsWith('.md') || f.type.startsWith('text/')) {
      const reader = new FileReader();
      reader.onload = () => setJd(String(reader.result || ''));
      reader.readAsText(f);
      return;
    }
    // …PDF / Word go to the server for text extraction.
    setParsing(true);
    try {
      const res = await api.uploadJD(f);
      if (res.error) { toast?.(res.error, 'err'); return; }
      setJd(res.text || '');
      toast?.(`Loaded JD from ${res.name || f.name}`, 'ok');
    } catch {
      toast?.('Could not read that file', 'err');
    } finally {
      setParsing(false);
    }
  }

  async function autofill() {
    if (jd.trim().length < 20) { toast?.('Paste a fuller job description first', 'err'); return; }
    setParsing(true);
    try {
      const p = await api.matchParse(jd);
      if (p.title) setQuery(p.title);
      if (p.skills?.length) setSkills((s) => dedupeCI([...s, ...p.skills]));
      if (p.state) setStateSel(p.state);
      if (p.city) setCity(p.city);
      if (p.minExperience != null) { setBand(''); setExpMin(String(p.minExperience)); setExpMax(''); }
      setParsed(p);
      toast?.('Brief filled from the JD — review & run', 'ok');
    } catch {
      toast?.('Could not read that JD', 'err');
    } finally {
      setParsing(false);
    }
  }

  // ── Run ──────────────────────────────────────────────────────
  const inIndia = country === 'India';
  const anywhere = country === 'Anywhere' || country === 'Remote';
  function run() {
    const countryPart = inIndia ? 'India' : anywhere ? '' : country;
    const location =
      [city.trim(), inIndia ? stateSel : '', countryPart].filter(Boolean).join(', ') || country;
    onRun({
      query: query.trim(),
      skills,
      city: city.trim(),
      state: inIndia ? stateSel : '',
      country,
      location,
      expMin: expMin === '' ? '' : Number(expMin),
      expMax: expMax === '' ? '' : Number(expMax),
      workMode,
      jd,
      openToWorkOnly,
      // "Only in <country>": filter results to that country. Off / "Anywhere" = no filter.
      countryOnly: anywhere ? false : countryOnly,
      indiaOnly: inIndia && countryOnly, // legacy flag for older server builds
      findContacts,
      sessionName,
      customActor: customActor.trim(),
      count: Number(limit), // how many candidates to return (exact target)
      limit: Number(limit),
    });
  }

  const hasExp = expMin !== '' || expMax !== '';

  return (
    <div className="brief">
      <div className="side-label">Sourcing brief</div>

      {/* ── Job description (paste / upload / auto-fill) ── */}
      <div className={`jd-card ${jdOpen ? 'open' : ''}`}>
        <button className="jd-card-head" onClick={() => setJdOpen((o) => !o)}>
          <span>✦ Job description</span>
          <span className="jd-card-meta">
            {jd ? `${jd.trim().length} chars` : 'paste or upload'} <span className="chev">{jdOpen ? '▴' : '▾'}</span>
          </span>
        </button>
        {jdOpen && (
          <div className="jd-card-body">
            <textarea
              className="brief-textarea"
              placeholder="Paste the full JD here — e.g. “Hiring a Senior React Developer in Bengaluru, 5+ years, React/Node/MongoDB…”"
              value={jd}
              onChange={(e) => setJd(e.target.value)}
            />
            <div className="jd-card-actions">
              <label className="mini-btn" title="Upload a PDF, Word (.docx) or text job description">
                {parsing ? 'Reading…' : '⤓ Upload'}
                <input type="file" accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown" onChange={onFile} hidden />
              </label>
              <button className="mini-btn primary" onClick={autofill} disabled={parsing}>
                {parsing ? 'Reading…' : '✦ Auto-fill brief'}
              </button>
              {jd && <button className="mini-btn ghost" onClick={() => { setJd(''); setParsed(null); }}>Clear</button>}
            </div>
            {parsed && (
              <div className="jd-parsed-mini">
                Detected: <b>{parsed.title || 'role'}</b>
                {parsed.minExperience != null ? ` · ${parsed.minExperience}+ yrs` : ''}
                {parsed.location ? ` · ${parsed.location}` : ''}
                {parsed.skills?.length ? ` · ${parsed.skills.length} skills` : ''}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Role ── */}
      <label className="field-label">Role / title</label>
      <input
        className="input"
        placeholder="e.g. Senior React Developer"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {/* ── Skills ── */}
      <label className="field-label">Must-have skills</label>
      <input
        className="input"
        placeholder="Type a skill, press Enter"
        value={skillInput}
        onChange={(e) => setSkillInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addSkill(skillInput); }
          if (e.key === 'Backspace' && !skillInput && skills.length) removeSkill(skills[skills.length - 1]);
        }}
      />
      {skills.length > 0 && (
        <div className="picked-chips">
          {skills.map((s) => (
            <button key={s} className="picked-chip" onClick={() => removeSkill(s)}>{s} ✕</button>
          ))}
        </div>
      )}

      {/* ── Location ── */}
      <label className="field-label">Location</label>
      <div className="brief-grid2">
        <select className="input select full" value={country} onChange={(e) => { setCountry(e.target.value); setStateSel(''); }}>
          {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {inIndia ? (
          <select
            className="input select full"
            value={stateSel}
            onChange={(e) => { setStateSel(e.target.value); setCity(''); }}
          >
            <option value="">Any state / UT</option>
            {Object.entries(statesByZone).map(([zone, states]) => (
              <optgroup key={zone} label={zone}>
                {states.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
              </optgroup>
            ))}
          </select>
        ) : (
          <input
            className="input full"
            list="brief-city-options"
            placeholder={anywhere ? 'City (optional)' : `City in ${country}`}
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
        )}
      </div>
      {inIndia && (
        <input
          className="input"
          style={{ marginTop: 8 }}
          list="brief-city-options"
          placeholder={stateSel ? `City in ${stateSel}` : 'City (optional)'}
          value={city}
          onChange={(e) => setCity(e.target.value)}
        />
      )}
      <datalist id="brief-city-options">
        {cityOptions.map((c) => <option key={c} value={c} />)}
      </datalist>

      {/* ── Experience ── */}
      <label className="field-label">
        Experience {hasExp && <span className="muted">· {expMin || 0}–{expMax || '∞'} yrs</span>}
      </label>
      <div className="exp-bands">
        {bands.map((b) => (
          <button
            key={b.key}
            className={`exp-band ${band === b.key ? 'on' : ''}`}
            onClick={() => pickBand(b)}
          >
            {b.label}
          </button>
        ))}
      </div>
      <div className="brief-grid2" style={{ marginTop: 8 }}>
        <input className="input full" inputMode="numeric" placeholder="Min yrs" value={expMin} onChange={(e) => onExpInput('min', e.target.value)} />
        <input className="input full" inputMode="numeric" placeholder="Max yrs" value={expMax} onChange={(e) => onExpInput('max', e.target.value)} />
      </div>

      {/* ── Work mode ── */}
      <label className="field-label">Work mode</label>
      <div className="exp-bands wm">
        {[
          { k: 'any', l: 'Any' },
          { k: 'remote', l: 'Remote' },
          { k: 'hybrid', l: 'Hybrid' },
          { k: 'onsite', l: 'On-site' },
        ].map((m) => (
          <button key={m.k} className={`exp-band ${workMode === m.k ? 'on' : ''}`} onClick={() => setWorkMode(m.k)}>
            {m.l}
          </button>
        ))}
      </div>

      {/* ── Session name ── */}
      <label className="field-label">Session name <span className="muted">(optional)</span></label>
      <input className="input" placeholder="e.g. Senior React · Pune" value={sessionName} onChange={(e) => setSessionName(e.target.value)} />

      {/* ── Toggles ── */}
      <div className="toggles">
        <button className="toggle-row" onClick={() => setOpenToWorkOnly((v) => !v)}>
          <span>Open-to-work only</span><span className={`switch ${openToWorkOnly ? 'on' : ''}`} />
        </button>
        <button className="toggle-row" onClick={() => setCountryOnly((v) => !v)} disabled={anywhere} title={anywhere ? 'Sourcing anywhere — no country filter' : `Keep only candidates in ${country}`}>
          <span>{anywhere ? 'Any country' : `Only ${country}`}</span><span className={`switch ${!anywhere && countryOnly ? 'on' : ''}`} />
        </button>
        <button className="toggle-row" onClick={() => setFindContacts((v) => !v)} title="Finds verified email for sourced candidates">
          <span>Find email <span className="prem">$</span></span><span className={`switch ${findContacts ? 'on' : ''}`} />
        </button>
      </div>

      <label className="field-label" style={{ marginTop: 16 }}>Candidates to pull · <b>{limit}</b></label>
      <input type="range" min="1" max="100" value={limit} onChange={(e) => setLimit(e.target.value)} />
      <div className="field-hint">We'll return exactly {limit}{Number(limit) === 1 ? ' candidate' : ' candidates'} when that many can be found.</div>

      {/* ── Advanced: bring your own Apify actor ── */}
      <button className="adv-toggle" onClick={() => setAdvOpen((o) => !o)}>
        <span>⚙ Advanced · custom Apify actor</span>
        <span className="chev">{advOpen ? '▴' : '▾'}</span>
      </button>
      {advOpen && (
        <div className="adv-body">
          <input
            className="input"
            placeholder="Paste an Apify actor URL or id"
            value={customActor}
            onChange={(e) => setCustomActor(e.target.value)}
          />
          <div className="field-hint">
            Any people-scraping actor works — e.g. <code>apify.com/owner/actor-name</code>, <code>owner/actor-name</code>,
            or a console link. It runs alongside your selected sources; we map its output automatically.
          </div>
        </div>
      )}

      <button className="run-btn" onClick={run} disabled={running}>
        {running ? `Pulling ${limit}…` : `Run sourcing · ${limit}`}
      </button>
      {lastRun && (
        <div className="run-note">
          <b>{lastRun.kept}</b>{lastRun.requestedCount ? ` of ${lastRun.requestedCount}` : ''} returned · +{lastRun.inserted} new · {lastRun.fetched} scanned
          {lastRun.relaxed ? ' · brief widened to reach your count' : ''}
          {lastRun.shortOfTarget ? ` · ${lastRun.shortOfTarget} short — broaden filters or add sources` : ''}
        </div>
      )}
    </div>
  );
}

function dedupeCI(arr) {
  const seen = new Set();
  const out = [];
  for (const s of arr) {
    const k = String(s).toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(s); }
  }
  return out;
}

// Compact the server labels ("1–3 yrs") for the tight sidebar chips.
function shortLabel(b) {
  return { ...b, label: b.label.replace(' yrs', 'y').replace('–', '–') };
}
