import { providers } from '../providers/index.js';
import { store } from '../store/index.js';
import { ensureShape, dedupeKey, dedupeBatch, isLikelyCompany } from './normalize.js';
import { scoreActiveIntent } from './activeSignal.js';
import { parseJD, scoreFit } from './jdMatch.js';
import { aiScore } from './aiMatch.js';
import { enrichOpenToWork } from './enrichOpenToWork.js';
import { enrichContacts } from './enrichContacts.js';
import { config, usingAI } from '../config.js';
import { isIndian, countryCodeOf, countryName, matchesCountry } from './geo.js';
import { parseActorId, makeCustomProvider } from '../providers/customApifyProvider.js';

// Over-fetch multiplier — we pull this many × the target across sources so that
// after dedupe + India filtering we still have enough to hand back EXACTLY the
// requested number. Kept modest: big per-actor requests are slow/timeout-prone,
// and the open-to-work gate is relaxed on already-fetched data (not by fetching
// more), so we don't need a huge buffer.
const OVERFETCH = 2;

// Fetch from every provider in parallel and return normalized candidates.
// Emits per-source progress as each provider resolves so the UI can tick live.
// Soft per-source deadline: one slow actor (a flaky source can sit near the hard
// 90s timeout) must not hold up the whole pass. We take whatever the fast sources
// returned and move on; the straggler is marked errored (→ skipped on re-fetch).
const SOURCE_SOFT_MS = Number(process.env.SOURCE_SOFT_MS) || 70_000;
async function collect({ providerList, query, perSource, records, location, onSource }) {
  const errors = [];
  const collected = [];
  await Promise.all(
    providerList.map(async (provider) => {
      try {
        const raw = await Promise.race([
          provider.fetch({ query, limit: perSource, records, location }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`${provider.id} exceeded ${Math.round(SOURCE_SOFT_MS / 1000)}s`)), SOURCE_SOFT_MS)
          ),
        ]);
        // Drop company / business pages — recruiters want people, not firms.
        const norm = (raw || [])
          .map((r) => ensureShape(provider.normalize(r), provider.id))
          .filter((c) => c.recordType === 'job-lead' || !isLikelyCompany(c));
        collected.push(...norm);
        onSource?.({ source: provider.id, got: norm.length });
      } catch (err) {
        errors.push({ source: provider.id, message: err.message });
        onSource?.({ source: provider.id, error: err.message });
      }
    })
  );
  return { collected, errors };
}

const normGeo = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '').replace(/sh/g, 's');

// Apply the audience filters; returns the surviving pool + how many each gate cut.
// Geography is matched at the level requested: `city` (tightest) OR, when no city is
// passed, `state` (region-wide). The fill logic relaxes city → state → anywhere when
// a tight city would otherwise return too few, so the recruiter sees nearby talent
// instead of an empty list.
function applyAudience(list, { countryCode, openToWorkOnly, expMin, expMax, workMode, city, state }) {
  let pool = list;
  let droppedNonIndia = 0;
  let droppedNotOpen = 0;
  let droppedExp = 0;
  let droppedCity = 0;

  // Country — keep candidates in the requested country (any country, not just
  // India). Null code means "anywhere" (no country constraint).
  if (countryCode) {
    const before = pool.length;
    pool = pool.filter((c) => c.recordType === 'job-lead' || matchesCountry(c, countryCode));
    droppedNonIndia = before - pool.length;
  }
  // City — when the recruiter names a city it's the tightest geo gate. Matched
  // against the candidate's city or location text, tolerant of common Indian
  // transliteration variants so "Nasik"/"Nashik", "Shimla"/"Simla",
  // "Bengaluru/Greater Bengaluru Area" all hit. (LinkedIn's location search is
  // fuzzy and returns state/country-wide profiles for a city query, so this gate
  // is relaxed to `state` in the fill passes rather than left to return zero.)
  if (city) {
    const want = normGeo(city);
    const before = pool.length;
    pool = pool.filter(
      (c) => c.recordType === 'job-lead' || normGeo(c.city).includes(want) || normGeo(c.location).includes(want)
    );
    droppedCity = before - pool.length;
  } else if (state) {
    // Region-wide fallback: keep the whole state (e.g. all Maharashtra), matched
    // against the candidate's state or location text.
    const want = normGeo(state);
    const before = pool.length;
    pool = pool.filter(
      (c) => c.recordType === 'job-lead' || normGeo(c.state).includes(want) || normGeo(c.location).includes(want)
    );
    droppedCity = before - pool.length;
  }
  if (openToWorkOnly) {
    const before = pool.length;
    // "Open to work only" means EXACTLY the candidates that carry the open-to-work
    // signal (the green badge → c.openToWork), plus anyone who applied to YOUR job
    // (unambiguously open). This MUST match the dashboard's open-to-work filter
    // (which checks c.openToWork) and the badge shown on each card — otherwise a
    // recruiter asking for "open to work only" sees people with no badge and thinks
    // the filter is broken. A loose headline phrase like "looking for opportunities"
    // still boosts the active-intent SCORE, but does not, by itself, qualify a
    // profile as open-to-work for this hard filter. Job-leads bypass (they're intel).
    pool = pool.filter(
      (c) => c.recordType === 'job-lead' || c.openToWork || c.appliedToJob
    );
    droppedNotOpen = before - pool.length;
  }
  // Experience band — LENIENT. The band mainly drives the title SEARCH (Junior /
  // Senior bias); here we only drop candidates CLEARLY outside it (more than ~2 yrs
  // past the edge), keeping band-edge people and unknowns. So a "fresher" search
  // won't surface a 15-yr veteran, but a genuine open-to-work 2-yr junior is never
  // wrongly dropped (the band-edge strictness was the bug). Works for every band.
  if (expMin != null || expMax != null) {
    const lo = expMin != null ? Math.max(0, expMin - 1) : null;
    const hi = expMax != null ? expMax + 2 : null;
    const before = pool.length;
    pool = pool.filter(
      (c) =>
        c.recordType === 'job-lead' ||
        c.experienceYears == null ||
        ((lo == null || c.experienceYears >= lo) && (hi == null || c.experienceYears <= hi))
    );
    droppedExp = before - pool.length;
  }
  // Work mode (remote / hybrid / onsite) — keep matches + unknowns (most profiles
  // don't state it), exclude only the clearly-mismatched.
  if (workMode && workMode !== 'any') {
    pool = pool.filter((c) => c.recordType === 'job-lead' || !c.workMode || c.workMode === workMode);
  }
  return { pool, droppedNonIndia, droppedNotOpen, droppedExp, droppedCity };
}

const byScore = (a, b) => (b.activeScore || 0) - (a.activeScore || 0);

// Normalize whatever the recruiter typed into a short, actor-friendly search.
// A pasted sentence ("1 year experience in React development from Nashik") makes
// actors hang/return nothing, so we extract a clean "<qualifier> <role>" phrase.
const ROLE_STEMS = ['develop', 'engineer', 'design', 'manage', 'analy', 'architect', 'consult', 'administrat', 'program', 'tester', 'devops', 'scien', 'recruit', 'market', 'account', 'lead', 'specialist'];
export function cleanSearchQuery(q = '', skills = []) {
  const s = String(q || '').trim();
  if (!s) return (skills || []).slice(0, 2).join(' ');
  const words = s.split(/\s+/);
  for (const stem of ROLE_STEMS) {
    const idx = words.findIndex((w) => w.toLowerCase().includes(stem));
    if (idx >= 0) {
      const role = words[idx].replace(/[^a-zA-Z+#.]/g, '');
      const prev = idx > 0 ? words[idx - 1].replace(/[^a-zA-Z+#.]/g, '') : '';
      // Prefer the word right before the role (e.g. "Backend Engineer"); only fall
      // back to a skill when there's no usable qualifier word.
      const STOP = new Set(['in', 'of', 'a', 'an', 'the', 'from', 'for', 'with', 'senior', 'sr', 'junior', 'jr', 'lead']);
      const qualifier = prev && !STOP.has(prev.toLowerCase()) ? prev : (skills && skills[0]) || prev || '';
      return [qualifier, role].filter(Boolean).join(' ').trim().slice(0, 60);
    }
  }
  if (skills && skills.length) return skills.slice(0, 2).join(' ');
  return words.slice(0, 4).join(' ').slice(0, 60);
}

// Prefix a seniority qualifier onto a role query so the LinkedIn search returns
// the right experience level (it ranks by relevance, not recency, so freshers are
// invisible to a generic title search). No-op if the query already states seniority.
const SENIORITY_RX = /\b(junior|jr|trainee|intern|associate|fresher|entry|graduate|senior|sr|lead|principal|staff|head|architect|manager|director|chief|vp|cto|ceo)\b/i;
export function biasQueryForExperience(q, expMin, expMax) {
  const query = String(q || '').trim();
  if (!query || SENIORITY_RX.test(query)) return query;
  // Fresher / 1-3 yrs → entry-level titles. 5+ yrs → senior titles. 3-5 (mid) keeps
  // the plain role and relies on the lenient years filter. Works for any role/country.
  if (expMax != null && expMax <= 3) return `Junior ${query}`;
  if (expMin != null && expMin >= 5) return `Senior ${query}`;
  return query;
}

// Alternate junior search titles to surface MORE entry-level people in the SAME
// city (fanned out instead of widening to other cities). Strips any seniority word.
function baseRole(q) {
  return String(q || '').replace(SENIORITY_RX, '').replace(/\s+/g, ' ').trim() || 'developer';
}
function juniorTitleVariants(q) {
  // Pass 1 already searched "Junior <role>"; fan out the OTHER entry-level titles.
  const base = baseRole(q);
  return [`Associate ${base}`, `Trainee ${base}`, `Graduate ${base}`];
}
function seniorTitleVariants(q) {
  const base = baseRole(q);
  return [`Lead ${base}`, `Principal ${base}`, `Staff ${base}`];
}
function roleVariants(q) {
  const base = baseRole(q);
  return [base, base.split(/\s+/).pop()].filter((v, i, a) => v && a.indexOf(v) === i);
}

/**
 * Run a sourcing job across one or more providers, returning EXACTLY `count`
 * candidates when that many can be found (over-fetches, then trims to target;
 * runs one relaxed top-up pass if a narrow brief comes up short).
 */
export async function runSourcing({
  orgId = null,
  sources,
  query = '',
  limit = 25,
  count = null,
  records,
  location = 'India',
  city = '',
  state = '',
  country = '',
  expMin = null,
  expMax = null,
  skills = [],
  jd = '',
  openToWorkOnly = true,
  indiaOnly = true,
  countryOnly = true,
  workMode = 'any',
  findContacts = false,
  sessionName = '',
  customActor = '',
  onEvent = () => {},
} = {}) {
  // Resolve the target country (works for any country, not just India). The
  // recruiter's "only this country" toggle decides whether we also filter to it.
  // Falls back to the legacy indiaOnly flag for older clients.
  const countryCode = countryOnly ? (countryCodeOf(country) ?? (indiaOnly ? 'IN' : null)) : null;
  const searchCountry = countryName(countryCode) || (countryCodeOf(country) ? countryName(countryCodeOf(country)) : null) || 'India';
  // Build the most specific location string we can from structured inputs.
  location = [city, state, country].filter(Boolean).join(', ') || location || searchCountry;
  // Keep the search query sane — a long pasted sentence makes actors hang or
  // return nothing, so distil it to a clean "<qualifier> <role>" phrase.
  query = cleanSearchQuery(query, skills);
  // Bias the search toward the requested seniority. A generic "developer" search
  // returns LinkedIn's top-ranked (mostly senior) profiles; freshers rank low and
  // never surface. Searching "Junior <role>" pulls actual entry-level people — the
  // accurate way to source freshers. Likewise bias senior searches.
  query = biasQueryForExperience(query, expMin, expMax);
  const startedAt = new Date();
  const t0 = Date.now();
  // Hard ceiling on total run time so a slow/hung source can never spin for minutes.
  // Sized to allow a cold-start fetch (~up to 120s) plus a relaxation top-up pass.
  // The streaming endpoint keeps the connection alive with progress events.
  const RUN_BUDGET_MS = Number(process.env.SOURCING_BUDGET_MS) || 240_000;
  const timeLeft = () => RUN_BUDGET_MS - (Date.now() - t0);
  const chosen = (sources?.length ? sources : Object.keys(providers)).filter((s) => providers[s]);

  // Optional user-supplied Apify actor → runs as an extra source.
  const customActorId = customActor ? parseActorId(customActor) : null;
  const customProvider = customActorId ? makeCustomProvider(customActorId) : null;
  const providerList = [...chosen.map((id) => providers[id]), ...(customProvider ? [customProvider] : [])];
  if (customProvider) chosen.push(customProvider.id);

  // Target = how many candidates the recruiter actually wants back.
  const target = count != null && Number(count) > 0 ? Math.min(Number(count), 200) : null;
  const numSources = Math.max(1, chosen.length);
  // Over-fetch a bit so dedupe/India filtering still leaves enough, but keep the
  // per-actor request modest — large requests are slow and can time out.
  const perSource = target
    ? Math.min(config.apify.maxItemsPerRun, Math.max(10, Math.ceil((target * OVERFETCH) / numSources)))
    : limit;

  const emit = (type, data) => { try { onEvent({ type, ...data }); } catch { /* ignore */ } };
  // Push the current best candidates to the client (sorted + trimmed to target).
  const snapshot = (list) => {
    const ranked = dedupeBatch(list).sort(byScore);
    return target ? ranked.slice(0, target) : ranked;
  };

  emit('start', { target, sources: chosen, location });

  // ── Pass 1: source for the exact brief ──────────────────────────────
  emit('phase', { message: `Searching ${chosen.length} source${chosen.length === 1 ? '' : 's'} for “${query || 'candidates'}”…` });
  const onSource = (s) => emit('source', s);
  const { collected, errors } = await collect({ providerList, query, perSource, records, location, onSource });
  // A source that errored/timed out once is treated as dead — we won't re-fetch
  // from it in the relaxation passes (that's what dragged narrow searches to
  // multiple minutes and stalled the stream before it could return the full set).
  const deadSources = new Set(errors.map((e) => e.source));
  emit('phase', { message: 'Scoring & matching candidates…', scanned: collected.length });
  await enrichOpenToWork(collected);
  for (const c of collected) {
    Object.assign(c, scoreActiveIntent(c));
    c.dedupeKey = dedupeKey(c);
  }
  let allRaw = collected; // every candidate we've fetched (unfiltered), reused below
  let fetched = collected.length;
  // The band drives the title SEARCH (biasQueryForExperience) + a LENIENT years
  // filter (applyAudience) that only drops clear mismatches — never band-edge juniors.
  let { pool, droppedNonIndia, droppedNotOpen, droppedExp } = applyAudience(collected, {
    countryCode, openToWorkOnly, expMin, expMax, workMode, city,
  });
  let deduped = dedupeBatch(pool);
  emit('candidates', { kept: deduped.length, scanned: fetched, candidates: snapshot(pool) });

  // ── Guaranteed fill: escalate relaxations until we hit the target ────
  // The recruiter asked for N candidates and expects N. We escalate in the
  // least-destructive order (drop experience → widen location → drop open-to-work
  // → broaden anywhere), keeping the most-active candidates ranked first. We track
  // what we relaxed so the UI can tell the recruiter "widened to reach your count".
  const relaxNotes = [];
  const want = () => target && deduped.length < target;

  // Re-filter the data we've ALREADY fetched with a given gate config (free).
  // `geo` selects the geography tightness: 'city' (default), 'state' (whole region),
  // or 'any' (country-wide) — used to relax a too-tight city without re-fetching.
  // `exp` (default true) applies the experience band; set false to relax seniority
  // while staying in-region (a Nashik search prefers a 4y Maharashtra dev over an
  // out-of-state fresher). open-to-work is never relaxed here when it was requested.
  const refilterWith = ({ otw, wm, geo = 'city', exp = true }, note) => {
    const geoArgs = geo === 'state' ? { state } : geo === 'any' ? {} : { city };
    const { pool: p } = applyAudience(allRaw, {
      countryCode, openToWorkOnly: otw, expMin: exp ? expMin : null, expMax: exp ? expMax : null,
      workMode: wm ? workMode : 'any', ...geoArgs,
    });
    const merged = dedupeBatch(p);
    if (merged.length > deduped.length) {
      deduped = merged;
      if (note && !relaxNotes.includes(note)) relaxNotes.push(note);
      emit('candidates', { kept: deduped.length, scanned: fetched, candidates: snapshot(p) });
    }
  };

  // Fetch a fresh broadened pass, then re-filter with the given gates.
  const widenAndRefill = async (loc, gates, note, qOverride) => {
    if (timeLeft() < 22_000) return;
    // Only re-hit sources that are still alive — re-querying a timed-out actor
    // just burns the time budget and stalls the run.
    const live = providerList.filter((p) => !deadSources.has(p.id));
    if (!live.length) return;
    const q = qOverride || query;
    emit('phase', { message: `${deduped.length} of ${target} so far — widening ${qOverride ? `search to “${q}”` : `to ${loc}`}…` });
    const more = await collect({ providerList: live, query: q, perSource, records: null, location: loc, onSource });
    for (const e of more.errors) { errors.push(e); deadSources.add(e.source); }
    if (!more.collected.length) return;
    await enrichOpenToWork(more.collected);
    for (const c of more.collected) { Object.assign(c, scoreActiveIntent(c)); c.dedupeKey = dedupeKey(c); }
    fetched += more.collected.length;
    allRaw = [...allRaw, ...more.collected];
    refilterWith(gates, note);
  };

  const stateLoc = [state, country].filter(Boolean).join(', ');
  const seenLoc = new Set([location]);
  const tryLoc = async (loc, gates, note) => {
    if (!want() || !loc || seenLoc.has(loc) || timeLeft() < 22_000) return;
    seenLoc.add(loc);
    await widenAndRefill(loc, gates, note);
  };

  // ── Fill the count by relaxing the SOFT gates / widening. Experience AND
  //    open-to-work are HARD requirements when the recruiter asked for them:
  //    a search for "open-to-work only" must NEVER be padded with people who
  //    aren't open to work just to hit the count (same philosophy as the exp
  //    band). We'd rather return fewer — an honest "X of Y" — than wrong people.
  //    `otw: openToWorkOnly` keeps the open-to-work gate ON through every fill
  //    pass whenever the recruiter requested it. ──
  // 1) relax work-mode (a genuinely soft preference) — but keep open-to-work intact.
  if (want() && workMode !== 'any') refilterWith({ otw: openToWorkOnly, exp: true, wm: false }, 'work-mode');

  // ── Only if STILL short, spend on broader fetches (live sources only) ──
  if (city) {
    // FREE first: LinkedIn's city search is fuzzy and the SAME fetch usually also
    // pulled profiles from the rest of the state (e.g. a "Nashik" query returns
    // Pune/Mumbai React devs too). Exact-Nashik matches are often few, so before
    // spending on more fetches, surface those already-fetched state-mates — that's
    // the difference between a useful list and a frustrating "0 candidates". Prefer
    // staying in-region: same-state at the requested seniority first, then same-state
    // with relaxed seniority (a 4y Maharashtra dev beats an out-of-state fresher for
    // a "Nashik" search), before we ever leave the state.
    if (want() && state) {
      refilterWith({ otw: openToWorkOnly, exp: true, wm: false, geo: 'state' }, `nearby ${state}`);
    }
    if (want() && state) {
      refilterWith({ otw: openToWorkOnly, exp: false, wm: false, geo: 'state' }, `nearby ${state}`);
    }
    // Fan out alternate titles in the SAME region to surface more local matches
    // (e.g. a fresher search: "Associate developer", "Trainee developer", "Graduate …").
    const variants = (expMax != null && expMax <= 3) ? juniorTitleVariants(query)
      : (expMin != null && expMin >= 5) ? seniorTitleVariants(query)
      : roleVariants(query);
    const cityFillGeo = state ? 'state' : 'any';
    for (const v of variants) {
      if (!want() || timeLeft() < 22_000) break;
      await widenAndRefill(location, { otw: openToWorkOnly, exp: true, wm: false, geo: cityFillGeo }, state ? `nearby ${state}` : 'title', v);
    }
    // STILL short → widen the SEARCH to the whole state, then country, keeping the
    // region (state) gate so results stay relevant — better than an empty session.
    if (want()) await tryLoc(stateLoc, { otw: openToWorkOnly, exp: true, wm: false, geo: cityFillGeo }, state ? `nearby ${state}` : 'location');
    if (want()) await tryLoc(searchCountry, { otw: openToWorkOnly, exp: true, wm: false, geo: 'any' }, 'location');
    // FREE final pass: the city/state searches above also pulled some out-of-region
    // profiles into allRaw. If we're still short (and a live re-fetch returned
    // nothing new), surface those country-wide matches we already have rather than
    // leaving the recruiter short — relevance is preserved by the city-first sort.
    if (want()) refilterWith({ otw: openToWorkOnly, exp: true, wm: false, geo: 'any' }, 'location');
  } else {
    // 3) widen location within the SELECTED country (state → whole country)
    if (want()) await tryLoc(stateLoc, { otw: openToWorkOnly, exp: true, wm: false }, 'location');
    if (want()) await tryLoc(searchCountry, { otw: openToWorkOnly, exp: true, wm: false }, 'location');
    // 4) final fallback — broaden the SEARCH itself to just the role keyword.
    if (want()) {
      const roleWord = query.split(/\s+/).pop();
      if (roleWord && roleWord.toLowerCase() !== query.toLowerCase()) {
        await widenAndRefill(searchCountry, { otw: openToWorkOnly, exp: true, wm: false }, 'role', roleWord);
      }
    }
  }

  // Safety net: never return zero when we actually fetched profiles in the region.
  // Honour the experience band and the open-to-work request, but relax the GEO from
  // city → state → country so a tight city (e.g. "Nashik") that no profile matches
  // exactly still surfaces the nearby state/country talent we already fetched,
  // instead of a frustrating empty session. (If open-to-work-only genuinely matched
  // nobody, we still respect it — that's an honest zero, not a geo problem.)
  if (deduped.length === 0 && allRaw.length) {
    for (const geo of ['state', 'any']) {
      const geoArgs = geo === 'state' ? { state } : {};
      if (geo === 'state' && !state) continue;
      const { pool: p } = applyAudience(allRaw, { countryCode, openToWorkOnly, expMin, expMax, workMode: 'any', ...geoArgs });
      const merged = dedupeBatch(p);
      if (merged.length) {
        deduped = merged;
        if (state && geo === 'state' && !relaxNotes.includes(`nearby ${state}`)) relaxNotes.push(`nearby ${state}`);
        break;
      }
    }
  }

  const relaxed = relaxNotes.length > 0;
  if (collected.length === 0 && errors.length > 0 && deduped.length === 0) {
    emit('phase', { message: `No profiles returned — ${errors.length} source${errors.length === 1 ? '' : 's'} errored. Check your sources or try a simpler role.` });
  }

  // ── Score JD-fit, rank by it, trim to the best-fit N ─────────────────
  // The rating shown to the recruiter = how well each profile matches the JD
  // (skills + role + location). We score every candidate, sort best-fit first,
  // then keep the top N — so the strongest matches surface, not just the most
  // "active" ones.
  const briefSkills = (skills || []).filter(Boolean);
  const jdObj = (jd && jd.trim().length > 20)
    ? parseJD(jd, briefSkills)
    : { title: query || '', skills: briefSkills, minExperience: expMin, seniority: 'mid', location, state, city };
  if (briefSkills.length) jdObj.skills = [...new Set([...(jdObj.skills || []), ...briefSkills])];

  for (const c of deduped) {
    const f = scoreFit(c, jdObj);
    c.fitScore = f.fitScore;
    c.matchedSkills = f.matchedSkills;
    c.missingSkills = f.missingSkills;
  }
  // Rank best-fit first, but when a specific city was requested, float exact-city
  // matches to the top so "Nashik" candidates lead and the relaxed nearby/state
  // talent follows (rather than being scattered or trimmed out by the target cap).
  const cityWant = city ? normGeo(city) : '';
  const inCity = (c) => (cityWant && (normGeo(c.city).includes(cityWant) || normGeo(c.location).includes(cityWant)) ? 1 : 0);
  deduped.sort((a, b) =>
    (inCity(b) - inCity(a)) ||
    (b.fitScore || 0) - (a.fitScore || 0) ||
    (b.activeScore || 0) - (a.activeScore || 0)
  );
  let finalList = target ? deduped.slice(0, target) : deduped;

  // AI re-rank the kept set for true semantic fit (when a Groq key is set).
  if (usingAI() && finalList.length) {
    emit('phase', { message: 'AI-scoring fit to your JD…' });
    try {
      const forAI = finalList.map((c, i) => ({ ...c, id: String(i) }));
      const ai = await aiScore(jdObj, forAI);
      if (ai.size) {
        ai.forEach((a, id) => {
          const c = finalList[Number(id)];
          if (c && typeof a.fit === 'number') {
            c.fitScore = a.fit;
            c.aiVerdict = a.verdict;
            c.aiReason = a.reason;
            if (a.matched?.length) c.matchedSkills = a.matched;
            if (a.missing?.length) c.missingSkills = a.missing;
          }
        });
        finalList.sort((x, y) => (y.fitScore || 0) - (x.fitScore || 0));
      }
    } catch { /* AI best-effort */ }
  }
  const strongMatches = finalList.filter((c) => (c.fitScore || 0) >= 70).length;
  emit('candidates', { kept: finalList.length, scanned: fetched, candidates: finalList });

  // Optional: find verified email for the candidates we're keeping (premium, capped).
  let contacts = null;
  if (findContacts && finalList.length) {
    emit('phase', { message: 'Finding verified emails…' });
    contacts = await enrichContacts(finalList.slice(0, config.apify.contactBulkCap));
  }

  // Stamp the tenant on every candidate so the pool stays isolated per org.
  for (const c of finalList) c.orgId = orgId;
  const { inserted, updated, ids } = await store.upsertCandidates(finalList);

  const defaultName = [query || 'All roles', location].filter(Boolean).join(' · ');
  const run = {
    orgId,
    name: (sessionName || defaultName).slice(0, 80),
    sources: chosen,
    query,
    location,
    brief: { city, state, country, expMin, expMax, skills, workMode, hasJd: Boolean(jd && jd.trim()) },
    customActor: customActorId || null,
    customActorInvalid: Boolean(customActor && !customActorId),
    filters: { openToWorkOnly, indiaOnly, expMin, expMax },
    requestedCount: target,
    requested: target || limit * chosen.length,
    fetched,
    kept: finalList.length,
    strongMatches,
    shortOfTarget: target ? Math.max(0, target - finalList.length) : 0,
    relaxed,
    relaxNotes,
    droppedNonIndia,
    droppedNotOpen,
    droppedExp,
    contacts,
    inserted,
    updated,
    candidateIds: ids || [],
    durationMs: Date.now() - t0,
    errors,
    startedAt,
  };
  const saved = await store.saveRun(run);
  return { run: saved, candidates: finalList };
}
