import { ScoreRing } from './ScoreRing.jsx';

function initials(name) {
  return name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
}

const STATUS_CLASS = {
  New: 'st-new', Shortlisted: 'st-short', Contacted: 'st-contact',
  Interviewing: 'st-interview', Hired: 'st-hired', Rejected: 'st-reject',
};

export function CandidateCard({ c, index = 0, sourceMeta, selected, onToggleSelect, onOpen, onStar, onContact, onFindEmail }) {
  // The rating shown is JD-fit (how well the profile matches the JD) when we have
  // it, falling back to active-intent before any JD scoring has run.
  const hasFit = c.fitScore != null;
  const rating = hasFit ? c.fitScore : c.activeScore;
  const band = rating >= 70 ? 'hot' : rating >= 40 ? 'warm' : 'cold';
  const place = [c.city, c.state].filter(Boolean).join(', ');
  const isLead = c.recordType === 'job-lead';

  return (
    <article className={`card ${selected ? 'sel' : ''}`} style={{ animationDelay: `${Math.min(index, 12) * 28}ms` }}>
      <label className="card-check" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={selected} onChange={() => onToggleSelect(c.id)} />
      </label>

      <div className="card-row" onClick={() => onOpen(c)}>
        <div className="avatar">{initials(c.fullName)}</div>

        <div className="card-info">
          <div className="card-top">
            <h3>{c.fullName}</h3>
            {c.status && <span className={`status-pill ${STATUS_CLASS[c.status] || ''}`}>{c.status}</span>}
            {c.recordType === 'job-lead' && <span className="badge lead">Hiring lead</span>}
            {c.openToWork && <span className="badge open">Open to work</span>}
            {c.appliedToJob && <span className="badge applied">Applied</span>}
          </div>
          <p className="headline">{c.headline || c.currentTitle}</p>

          <div className="meta">
            {c.currentCompany && <span className="mi">{c.currentCompany}</span>}
            {place ? <span className="mi">{place}{c.countryCode === 'IN' ? ' · IN' : ''}</span> : c.location ? <span className="mi">{c.location}</span> : null}
            {c.experienceYears != null && (
              <span className="mi">{c.experienceYears === 0 ? 'Fresher' : `${c.experienceYears}y exp`}</span>
            )}
            {c.workMode && <span className="mi wm-tag">{c.workMode === 'onsite' ? 'On-site' : c.workMode[0].toUpperCase() + c.workMode.slice(1)}</span>}
            {hasFit && c.matchedSkills && (c.matchedSkills.length + (c.missingSkills?.length || 0)) > 0 && (
              <span className="mi match-tag">✓ {c.matchedSkills.length}/{c.matchedSkills.length + (c.missingSkills?.length || 0)} JD skills</span>
            )}
            {c.noticePeriodDays != null && (
              <span className={`mi ${c.noticePeriodDays <= 15 ? 'urgent' : ''}`}>
                {c.noticePeriodDays === 0 ? 'Immediate joiner' : `${c.noticePeriodDays}d notice`}
              </span>
            )}
            {c.email && <span className="mi has-email">✉ email</span>}
          </div>

          {(c.skills || []).length > 0 && (
            <div className="chips">
              {(c.skills || []).slice(0, 6).map((s) => <span key={s} className="chip">{s}</span>)}
              {c.skills.length > 6 && <span className="chip more">+{c.skills.length - 6}</span>}
            </div>
          )}

          <div className="card-bottom">
            <div className="cites">
              {(c.sources || [c.source]).map((s) => {
                const m = sourceMeta[s] || { dot: '#9aa0a8', label: s };
                return <span key={s} className="cite"><span className="cite-dot" style={{ background: m.dot }} />{m.label}</span>;
              })}
            </div>
            {/* One-click contact (or two: find email → contact). Hidden for hiring leads. */}
            {!isLead && (onContact || onFindEmail) && (
              c.email ? (
                <button className="contact-btn" onClick={(e) => { e.stopPropagation(); onContact?.(c); }} title={`Email ${c.email}`}>
                  ✉ Contact
                </button>
              ) : (
                <button className="contact-btn ghost" onClick={(e) => { e.stopPropagation(); onFindEmail?.(c, true); }} title="Find a verified email, then draft the message">
                  🔎 Find email & contact
                </button>
              )
            )}
          </div>
        </div>

        <div className="card-actions">
          <button className={`star ${c.starred ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); onStar(c); }} title="Shortlist">
            {c.starred ? '★' : '☆'}
          </button>
          <div className="score">
            <ScoreRing score={rating} />
            <span className={`band-pill ${band}`}>{hasFit ? 'JD fit' : band}</span>
          </div>
          <span className="open-hint">View →</span>
        </div>
      </div>
    </article>
  );
}
