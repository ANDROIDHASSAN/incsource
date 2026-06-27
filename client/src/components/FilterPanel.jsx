import { useState } from 'react';

const BANDS = [
  { key: '', label: 'All' },
  { key: 'hot', label: '🔥 Hot' },
  { key: 'warm', label: 'Warm' },
  { key: 'cold', label: 'Cold' },
];

const EXP_RANGES = [
  { v: '', label: 'Any' },
  { v: '0-1', label: 'Fresher' },
  { v: '1-3', label: '1–3 yrs' },
  { v: '3-5', label: '3–5 yrs' },
  { v: '5-8', label: '5–8 yrs' },
  { v: '8-12', label: '8–12 yrs' },
  { v: '12-', label: '12+ yrs' },
];

const SORTS = [
  { v: '-fitScore', label: 'JD fit ↓' },
  { v: '-activeScore', label: 'Active intent ↓' },
  { v: 'fullName', label: 'Name A–Z' },
  { v: '-updatedAt', label: 'Newest' },
  { v: 'noticePeriodDays', label: 'Notice ↑' },
];

export function FilterPanel({ filters, set, facets, geo = { states: [], zones: [], metros: [] }, stages = [], count, onClear }) {
  const [open, setOpen] = useState(false);
  const f = filters;
  const toggleIn = (key, value) =>
    set({ [key]: f[key].includes(value) ? f[key].filter((x) => x !== value) : [...f[key], value] });

  // Candidate counts per state, to annotate the dropdown.
  const stateCount = Object.fromEntries((facets.states || []).map((s) => [s.value, s.count]));

  // States shown: full India list, narrowed to the chosen region, minus already-picked.
  const zones = geo.zones || [];
  const regionStates = f.region ? new Set((zones.find((z) => z.name === f.region) || {}).states || []) : null;
  const statesByZone = (geo.states || []).reduce((acc, s) => {
    if (regionStates && !regionStates.has(s.name)) return acc;
    if (f.states.includes(s.name)) return acc; // hide already-picked
    (acc[s.zone || 'Other'] ||= []).push(s);
    return acc;
  }, {});

  // City suggestions: union of cities for the picked states, else metros; minus picked.
  const selectedStateObjs = (geo.states || []).filter((s) => f.states.includes(s.name));
  const cityOptions = (
    selectedStateObjs.length ? selectedStateObjs.flatMap((s) => s.cities) : geo.metros || []
  ).filter((c) => !f.cities.includes(c));

  const addState = (v) => v && set({ states: [...f.states, v], cities: [] });
  const removeState = (v) => set({ states: f.states.filter((x) => x !== v) });
  const addCity = (v) => {
    const t = (v || '').trim();
    if (t && !f.cities.includes(t)) set({ cities: [...f.cities, t] });
  };
  const removeCity = (v) => set({ cities: f.cities.filter((x) => x !== v) });

  // Experience range encoded as "min-max" ('' max = open-ended).
  const expValue = f.expMin !== '' && f.expMin != null ? `${f.expMin}-${f.expMax === '' || f.expMax == null ? '' : f.expMax}` : '';
  const setExp = (v) => {
    if (!v) return set({ expMin: '', expMax: '' });
    const [min, max] = v.split('-');
    set({ expMin: Number(min), expMax: max === '' ? '' : Number(max) });
  };

  const activeCount =
    (f.q ? 1 : 0) + (f.band ? 1 : 0) + (f.minScore > 0 ? 1 : 0) + (f.region ? 1 : 0) +
    f.states.length + f.cities.length + f.sources.length + f.skills.length + (f.status?.length || 0) +
    (f.openToWork ? 1 : 0) + (f.indiaOnly ? 1 : 0) + (f.hasEmail ? 1 : 0) + (f.starred ? 1 : 0) +
    (f.noticeMaxDays ? 1 : 0) + (f.includeLeads ? 1 : 0) + (expValue ? 1 : 0);

  return (
    <div className="filter-panel">
      <div className="fp-head">
        <div className="fp-title">
          Filters {activeCount > 0 && <span className="fp-badge">{activeCount}</span>}
          <span className="fp-count">{count} shown</span>
        </div>
        <div className="fp-head-actions">
          {activeCount > 0 && (
            <button className="fp-clear" onClick={onClear}>
              Clear all
            </button>
          )}
          <button className="fp-toggle" onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {/* Always-visible primary row */}
      <div className="fp-row">
        <input
          className="input"
          placeholder="Search name, skill, company…"
          value={f.q}
          onChange={(e) => set({ q: e.target.value })}
          style={{ flex: 1, minWidth: 200 }}
        />
        <div className="band-pills">
          {BANDS.map((b) => (
            <button
              key={b.key}
              className={`pill ${f.band === b.key ? 'on' : ''}`}
              onClick={() => set({ band: b.key })}
            >
              {b.label}
            </button>
          ))}
        </div>
        <select className="input select" value={f.sort} onChange={(e) => set({ sort: e.target.value })}>
          {SORTS.map((s) => (
            <option key={s.v} value={s.v}>{s.label}</option>
          ))}
        </select>
      </div>

      {open && (
        <div className="fp-grid">
          {/* Region / zone */}
          <div className="fp-field">
            <label>Region</label>
            <select
              className="input select"
              value={f.region}
              onChange={(e) => set({ region: e.target.value })}
            >
              <option value="">All India</option>
              {zones.map((z) => (
                <option key={z.name} value={z.name}>{z.name}</option>
              ))}
            </select>
          </div>

          {/* Quick metro — adds a city chip */}
          <div className="fp-field">
            <label>Quick metro</label>
            <select className="input select" value="" onChange={(e) => { addCity(e.target.value); e.target.value = ''; }}>
              <option value="">Add a metro…</option>
              {(geo.metros || []).filter((m) => !f.cities.includes(m)).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* States — multi-select: dropdown adds, chips remove */}
          <div className="fp-field wide">
            <label>States / UTs {f.states.length > 0 && <span className="cnt">{f.states.length} selected</span>}</label>
            <select className="input select" value="" onChange={(e) => { addState(e.target.value); e.target.value = ''; }}>
              <option value="">+ Add state…{f.region ? ` (${f.region})` : ''}</option>
              {Object.entries(statesByZone).map(([zone, states]) => (
                <optgroup key={zone} label={zone}>
                  {states.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name}{stateCount[s.name] ? ` (${stateCount[s.name]})` : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {f.states.length > 0 && (
              <div className="picked-chips">
                {f.states.map((s) => (
                  <button key={s} className="picked-chip" onClick={() => removeState(s)}>
                    {s} ✕
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Cities — multi-select: typeable + suggestions, chips remove */}
          <div className="fp-field wide">
            <label>Cities {f.cities.length > 0 && <span className="cnt">{f.cities.length} selected</span>}</label>
            <input
              className="input"
              list="city-options"
              placeholder={selectedStateObjs.length ? `Add city in ${f.states.join(', ')} — Enter to add` : 'Type a city, press Enter to add'}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); addCity(e.target.value); e.target.value = ''; }
              }}
              onChange={(e) => {
                // datalist click fills the value fully → add it immediately
                if (cityOptions.includes(e.target.value)) { addCity(e.target.value); e.target.value = ''; }
              }}
            />
            <datalist id="city-options">
              {cityOptions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            {f.cities.length > 0 && (
              <div className="picked-chips">
                {f.cities.map((c) => (
                  <button key={c} className="picked-chip" onClick={() => removeCity(c)}>
                    {c} ✕
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Min score */}
          <div className="fp-field">
            <label>Min score: {f.minScore}</label>
            <input type="range" min="0" max="100" value={f.minScore} onChange={(e) => set({ minScore: Number(e.target.value) })} />
          </div>

          {/* Experience */}
          <div className="fp-field">
            <label>Experience</label>
            <select className="input select" value={expValue} onChange={(e) => setExp(e.target.value)}>
              {EXP_RANGES.map((r) => (
                <option key={r.v} value={r.v}>{r.label}</option>
              ))}
            </select>
          </div>

          {/* Notice period */}
          <div className="fp-field">
            <label>Max notice (days)</label>
            <select className="input select" value={f.noticeMaxDays} onChange={(e) => set({ noticeMaxDays: e.target.value })}>
              <option value="">Any</option>
              <option value="0">Immediate</option>
              <option value="15">≤ 15</option>
              <option value="30">≤ 30</option>
              <option value="60">≤ 60</option>
            </select>
          </div>

          {/* Sources */}
          <div className="fp-field wide">
            <label>Sources</label>
            <div className="chip-select">
              {(facets.sources || []).map((s) => (
                <button
                  key={s.value}
                  className={`chip-btn ${f.sources.includes(s.value) ? 'on' : ''}`}
                  onClick={() => toggleIn('sources', s.value)}
                >
                  {s.value} ({s.count})
                </button>
              ))}
              {!(facets.sources || []).length && <span className="muted">— run a sourcing job first —</span>}
            </div>
          </div>

          {/* Skills */}
          <div className="fp-field wide">
            <label>
              Skills{' '}
              <button className="mini-toggle" onClick={() => set({ skillsMatch: f.skillsMatch === 'all' ? 'any' : 'all' })}>
                match {f.skillsMatch.toUpperCase()}
              </button>
            </label>
            <div className="chip-select scroll">
              {(facets.skills || []).map((s) => (
                <button
                  key={s.value}
                  className={`chip-btn ${f.skills.includes(s.value) ? 'on' : ''}`}
                  onClick={() => toggleIn('skills', s.value)}
                >
                  {s.value} ({s.count})
                </button>
              ))}
              {!(facets.skills || []).length && <span className="muted">— no skills yet —</span>}
            </div>
          </div>

          {/* Pipeline status */}
          {stages.length > 0 && (
            <div className="fp-field wide">
              <label>Pipeline status</label>
              <div className="chip-select">
                {stages.map((s) => (
                  <button key={s} className={`chip-btn ${(f.status || []).includes(s) ? 'on' : ''}`} onClick={() => toggleIn('status', s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Boolean toggles */}
          <div className="fp-field wide">
            <div className="bool-row">
              <Check label="★ Shortlisted" on={f.starred} set={(v) => set({ starred: v })} />
              <Check label="🟢 Open to work" on={f.openToWork} set={(v) => set({ openToWork: v })} />
              <Check label="🇮🇳 India only" on={f.indiaOnly} set={(v) => set({ indiaOnly: v })} />
              <Check label="✉️ Has email" on={f.hasEmail} set={(v) => set({ hasEmail: v })} />
              <Check label="Include job leads" on={f.includeLeads} set={(v) => set({ includeLeads: v })} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Check({ label, on, set }) {
  return (
    <label className="chk">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      {label}
    </label>
  );
}
