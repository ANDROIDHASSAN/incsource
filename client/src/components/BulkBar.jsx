export function BulkBar({ count, stages, onStatus, onStar, onEnrich, onEmail, onExport, onDelete, onClear, enriching }) {
  if (!count) return null;
  return (
    <div className="bulk-bar">
      <div className="bulk-count">{count} selected</div>
      <div className="bulk-actions">
        <select className="input select" defaultValue="" onChange={(e) => { if (e.target.value) { onStatus(e.target.value); e.target.value = ''; } }}>
          <option value="">Set status…</option>
          {stages.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="btn sm" onClick={onStar}>★ Shortlist</button>
        <button className="btn sm" onClick={onEnrich} disabled={enriching}>{enriching ? 'Finding…' : '🔎 Find email'}</button>
        <button className="btn sm" onClick={onEmail}>✈ Send email</button>
        <button className="btn sm" onClick={onExport}>Export CSV</button>
        <button className="btn sm danger" onClick={onDelete}>Delete</button>
        <button className="btn sm ghost" onClick={onClear}>Clear</button>
      </div>
    </div>
  );
}
