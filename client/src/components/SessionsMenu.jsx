import { useState } from 'react';

// Relative "time ago" for the session history list (ChatGPT-style).
function ago(ts) {
  if (!ts) return '';
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

export function SessionsMenu({ sessions, active, onNew, onOpen, onExit, onRename, onDelete }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="sessions" onClick={() => setOpen((o) => !o)}>
      <button className={`btn sm ${active ? 'primary' : ''}`}>
        🗂 {active ? active.name : 'Sessions'} <span className="chev">▾</span>
      </button>
      {open && (
        <div className="sessions-menu" onClick={(e) => e.stopPropagation()}>
          <button className="session-new" onClick={() => { onNew(); setOpen(false); }}>
            <span className="plus">＋</span> New session
          </button>

          <div className="sessions-head">
            <span>History</span>
            {active && <button className="link-btn" onClick={() => { onExit(); setOpen(false); }}>View all candidates</button>}
          </div>

          {sessions.length === 0 && (
            <div className="muted sm" style={{ padding: '10px 12px' }}>
              No sessions yet. Run a sourcing search and it’ll appear here.
            </div>
          )}

          <div className="sessions-list">
            {sessions.map((s) => (
              <div key={s.id} className={`session-row ${active && active.id === s.id ? 'on' : ''}`}>
                <button className="session-open" onClick={() => { onOpen(s); setOpen(false); }}>
                  <span className="session-name">{s.name || 'Untitled search'}</span>
                  <span className="session-meta">
                    {s.candidateCount ?? s.kept ?? 0} candidates · {ago(s.createdAt || s.startedAt)}
                  </span>
                </button>
                <button className="session-act" title="Rename" onClick={() => onRename(s)}>✎</button>
                <button className="session-act del" title="Delete session" onClick={() => onDelete(s)}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
