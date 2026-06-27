import { useState } from 'react';

const BAND_COLOR = { Hot: '#f2464b', Warm: '#e8aa4e', Cold: '#9aa0a8' };
const STATUS_COLOR = {
  New: '#626262', Shortlisted: '#12b6bc', Contacted: '#133f7a',
  Interviewing: '#e8aa4e', Hired: '#18ac00', Rejected: '#f2464b',
};

function Bars({ data, color, colorMap }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="bars">
      {data.slice(0, 6).map((d) => (
        <div key={d.value} className="bar-row">
          <span className="bar-label" title={d.value}>{d.value}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(d.count / max) * 100}%`, background: (colorMap && colorMap[d.value]) || color }} />
          </span>
          <span className="bar-count">{d.count}</span>
        </div>
      ))}
      {!data.length && <span className="muted sm">No data yet</span>}
    </div>
  );
}

export function Analytics({ data }) {
  const [open, setOpen] = useState(true);
  if (!data) return null;
  return (
    <div className="analytics">
      <div className="an-head">
        <div className="an-title">
          Talent insights
          <span className="an-sub">avg intent {data.avgScore} · {data.openToWork} open to work · {data.total} total</span>
        </div>
        <button className="fp-toggle" onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Show'}</button>
      </div>
      {open && (
        <div className="an-grid">
          <div className="an-card"><h5>Pipeline</h5><Bars data={data.byStatus} colorMap={STATUS_COLOR} color="#133f7a" /></div>
          <div className="an-card"><h5>Intent band</h5><Bars data={data.byBand} colorMap={BAND_COLOR} color="#133f7a" /></div>
          <div className="an-card"><h5>By source</h5><Bars data={data.bySource} color="#12b6bc" /></div>
          <div className="an-card"><h5>Top states</h5><Bars data={data.byState} color="#133f7a" /></div>
          <div className="an-card wide"><h5>In-demand skills</h5><Bars data={data.bySkill} color="#18ac00" /></div>
        </div>
      )}
    </div>
  );
}
