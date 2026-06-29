import { useEffect, useRef } from 'react';

// ── Agentic "mission control" stage ──────────────────────────────────────────
// A futuristic, live orchestration view: the Orchestrator core at centre with its
// specialist agents on a radial network, animated edges that light up as work
// flows, and a real-time MESSAGE BUS of the agents' chatter. It is purely a view
// over the polled job state (agents[], events[], candidates) — no logic of its own.
//
// Node geometry and the SVG edge endpoints share one coordinate space (a 0–100
// box): a ring node sits at (50 + R·cosθ, 50 + R·sinθ) as a CSS percentage, and the
// matching edge ends at the same point in the SVG viewBox, so lines always touch.
const RING_RADIUS = 38;

function ringPos(i, n) {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; // start at top, go clockwise
  return { x: 50 + RING_RADIUS * Math.cos(a), y: 50 + RING_RADIUS * Math.sin(a) };
}

const KIND_LABEL = { system: '', think: '', dispatch: '→', result: '✓', error: '✕' };

export function AgentStage({ job, brief, onClose }) {
  const agents = job?.agents || [];
  const events = job?.events || [];
  const core = agents.find((a) => a.id === 'orchestrator');
  const ring = agents.filter((a) => a.id !== 'orchestrator');
  const logRef = useRef(null);

  // Keep the message bus pinned to the newest line.
  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [events.length]);

  const status = job?.status || 'running';
  const running = status === 'running';
  const failed = status === 'error';
  const done = !running;
  const kept = job?.kept || 0;
  const scanned = job?.scanned || 0;
  const total = Number(brief?.count) || 0;
  const elapsed = job?.elapsedMs ? (job.elapsedMs / 1000).toFixed(1) : '0.0';
  const doneCount = agents.filter((a) => a.status === 'done' || a.status === 'skipped').length;
  const activeCount = agents.filter((a) => a.status === 'working').length;
  const pct = failed ? 100
    : total ? Math.min(100, Math.round((kept / total) * 100))
    : kept ? Math.min(92, 24 + kept * 6)
    : done ? 100 : 12;

  const title = failed ? 'Run hit a snag'
    : done ? 'Run complete'
    : activeCount ? 'Agents are working'
    : 'Dispatching the agent team';

  const nodeName = (id) => agents.find((a) => a.id === id)?.name?.split(' ')[0] || id;

  return (
    <div className="agent-stage" role="status" aria-live="polite">
      <div className="stage-aurora" />
      <div className="stage-grid-bg" />
      {onClose && (
        <button className="stage-close" onClick={onClose} aria-label="Close orchestration view" title="Hide — results stay in your list">×</button>
      )}

      <div className="stage-inner">
        <header className="stage-head">
          <div className="stage-eyebrow">
            <span className={`stage-orb ${failed ? 'err' : done ? 'ok' : 'live'}`} /> Agent orchestration
          </div>
          <h2 className="stage-title">{title}</h2>
          <div className="stage-stats">
            <span className="stat-pill"><span className={done ? '' : 'stat-live'} />{doneCount}/{agents.length} agents {done ? 'done' : 'active'}</span>
            <span className="stat-pill accent">{kept}{total ? ` / ${total}` : ''} found</span>
            {scanned > 0 && <span className="stat-pill mono">{scanned} scanned</span>}
            <span className="stat-pill mono">{elapsed}s</span>
            {brief?.role && <span className="stat-pill">{[brief.role, brief.city].filter(Boolean).join(' · ')}</span>}
          </div>
          <div className="stage-progress"><span className={`stage-progress-fill ${failed ? 'err' : ''}`} style={{ width: `${pct}%` }} /></div>
        </header>

        <div className="stage-main">
          {/* ── Radial orchestration graph ── */}
          <div className="orch-graph">
            <svg className="orch-edges" viewBox="0 0 100 100" preserveAspectRatio="none">
              {ring.map((a, i) => {
                const p = ringPos(i, ring.length);
                const cls = a.status === 'working' ? 'working' : a.status === 'done' ? 'done' : a.status === 'failed' ? 'failed' : '';
                return <line key={a.id} className={`oedge ${cls}`} x1="50" y1="50" x2={p.x} y2={p.y} />;
              })}
            </svg>

            {core && (
              <div className={`onode core ${core.status}`} style={{ left: '50%', top: '50%' }}>
                <div className="onode-core-glow" />
                <div className="onode-ava">
                  {core.status === 'working' && <span className="onode-ring" />}
                  <span className="onode-emoji">{core.icon}</span>
                </div>
                <div className="onode-label">{core.name}</div>
                <div className="onode-state">{core.detail || core.role}</div>
              </div>
            )}

            {ring.map((a, i) => {
              const p = ringPos(i, ring.length);
              return (
                <div key={a.id} className={`onode ${a.status}`} style={{ left: `${p.x}%`, top: `${p.y}%` }}>
                  <div className="onode-ava">
                    {a.status === 'working' && <span className="onode-ring" />}
                    <span className="onode-emoji">{a.icon}</span>
                    {a.status === 'done' && <span className="onode-badge ok">✓</span>}
                    {a.status === 'failed' && <span className="onode-badge err">!</span>}
                  </div>
                  <div className="onode-label">{a.name}</div>
                  <div className="onode-state">{a.detail || a.role}</div>
                </div>
              );
            })}
          </div>

          {/* ── Live message bus ── */}
          <div className="orch-stream">
            <div className="ostream-head">
              <span className={`ostream-dot ${running ? 'live' : ''}`} /> Message bus
              <span className="ostream-count">{events.length}</span>
            </div>
            <div className="ostream-log" ref={logRef}>
              {events.map((e) => (
                <div key={e.id} className={`oev ${e.kind}`}>
                  <span className="oev-t">{(e.t / 1000).toFixed(1)}s</span>
                  <span className="oev-row">
                    {e.kind === 'system' ? (
                      <span className="oev-sys">{e.text}</span>
                    ) : (
                      <>
                        <span className="oev-route">
                          <b>{nodeName(e.from) || 'system'}</b>
                          {e.to && <><span className="oev-arrow">{KIND_LABEL[e.kind] || '·'}</span><b>{nodeName(e.to)}</b></>}
                        </span>
                        <span className="oev-text">{e.text}</span>
                      </>
                    )}
                  </span>
                </div>
              ))}
              {running && <div className="oev oev-cursor"><span /></div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
