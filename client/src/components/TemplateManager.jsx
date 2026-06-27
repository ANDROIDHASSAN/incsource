import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useEscapeClose } from '../useEscapeClose.js';

const BLANK = { id: null, name: '', subject: '', body: '' };
const VARS = ['{{firstName}}', '{{name}}', '{{role}}', '{{company}}', '{{recruiter}}', '{{skillLine}}'];

export function TemplateManager({ templates, onChange, onClose, toast }) {
  const [sel, setSel] = useState(null); // selected template id or 'new'
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  useEscapeClose(onClose);

  const current = templates.find((t) => t.id === sel);
  const editable = sel === 'new' || (current && current.custom);

  useEffect(() => {
    if (sel === 'new') setForm(BLANK);
    else if (current) setForm({ id: current.id, name: current.name, subject: current.subject, body: current.body });
  }, [sel]); // eslint-disable-line

  async function save() {
    if (!form.name || !form.subject || !form.body) { toast('Name, subject and body are required', 'err'); return; }
    setSaving(true);
    try {
      if (form.id) await api.updateTemplate(form.id, form);
      else { const t = await api.createTemplate(form); setSel(t.id); }
      await onChange();
      toast('Template saved', 'ok');
    } finally { setSaving(false); }
  }

  async function remove(id) {
    await api.deleteTemplate(id);
    setSel(null); setForm(BLANK);
    await onChange();
    toast('Template deleted');
  }

  function dup(t) {
    setSel('new');
    setForm({ id: null, name: `${t.name} (copy)`, subject: t.subject, body: t.body });
  }

  function insertVar(v) {
    setForm((f) => ({ ...f, body: `${f.body}${v}` }));
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal tpl-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <header className="jd-head">
          <div className="jd-spark">✉</div>
          <div><h2>Email templates</h2><p className="modal-headline">Use built-ins or create your own. Variables auto-fill per candidate.</p></div>
        </header>

        <div className="tpl-body">
          <div className="tpl-list">
            <button className="btn primary full" onClick={() => setSel('new')}>+ New template</button>
            <div className="tpl-group">Built-in</div>
            {templates.filter((t) => !t.custom).map((t) => (
              <button key={t.id} className={`tpl-item ${sel === t.id ? 'on' : ''}`} onClick={() => setSel(t.id)}>
                {t.name}<span className="tpl-tag">built-in</span>
              </button>
            ))}
            <div className="tpl-group">Custom</div>
            {templates.filter((t) => t.custom).map((t) => (
              <button key={t.id} className={`tpl-item ${sel === t.id ? 'on' : ''}`} onClick={() => setSel(t.id)}>{t.name}</button>
            ))}
            {!templates.some((t) => t.custom) && <span className="muted sm" style={{ padding: '8px 4px' }}>No custom templates yet</span>}
          </div>

          <div className="tpl-editor">
            {!sel ? (
              <div className="jd-empty"><div className="empty-mark">✉</div><p>Select a template or create a new one.</p></div>
            ) : (
              <>
                <label className="field-label">Template name</label>
                <input className="input full" value={form.name} disabled={!editable} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <label className="field-label">Subject</label>
                <input className="input full" value={form.subject} disabled={!editable} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
                <label className="field-label">Body</label>
                <textarea className="notes tpl-textarea" rows={9} value={form.body} disabled={!editable} onChange={(e) => setForm({ ...form, body: e.target.value })} />
                {editable && (
                  <div className="tpl-vars">
                    {VARS.map((v) => <button key={v} className="chip-btn" onClick={() => insertVar(v)}>{v}</button>)}
                  </div>
                )}
                <div className="tpl-actions">
                  {editable ? (
                    <>
                      <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save template'}</button>
                      {form.id && <button className="btn danger" onClick={() => remove(form.id)}>Delete</button>}
                    </>
                  ) : (
                    <>
                      <span className="muted sm">Built-in templates are read-only.</span>
                      <button className="btn" onClick={() => dup(current)}>Duplicate &amp; edit</button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
