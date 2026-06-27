export function Toasts({ toasts }) {
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind || ''}`}>{t.msg}</div>
      ))}
    </div>
  );
}
