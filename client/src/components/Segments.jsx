export function Segments({ segments, onApply, onSave, onDelete, activeCount }) {
  return (
    <div className="segments">
      <span className="seg-label">Saved searches</span>
      <div className="seg-chips">
        {segments.map((s) => (
          <span key={s.id} className="seg-chip">
            <button className="seg-apply" onClick={() => onApply(s)}>{s.name}</button>
            <button className="seg-del" onClick={() => onDelete(s.id)} title="Delete">×</button>
          </span>
        ))}
        {!segments.length && <span className="muted sm">No saved searches yet</span>}
        <button className="seg-save" onClick={onSave} disabled={!activeCount} title={activeCount ? 'Save current filters' : 'Apply some filters first'}>
          + Save current
        </button>
      </div>
    </div>
  );
}
