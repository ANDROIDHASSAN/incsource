const BANDS = {
  hot: { arc: '#f2464b', track: '#feeded', num: '#b63538' },
  warm: { arc: '#e8aa4e', track: '#fdf7ed', num: '#ae803b' },
  cold: { arc: '#cecece', track: '#efefef', num: '#626262' },
};

export function ScoreRing({ score = 0, size = 56 }) {
  const r = (size - 7) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  const dash = (pct / 100) * circ;
  const band = pct >= 70 ? 'hot' : pct >= 40 ? 'warm' : 'cold';
  const c = BANDS[band];

  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={c.track} strokeWidth="6" fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={c.arc}
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="ring-num" style={{ color: c.num }}>{Math.round(pct)}</span>
    </div>
  );
}
