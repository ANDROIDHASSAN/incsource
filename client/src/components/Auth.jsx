import { useState } from 'react';
import { api, auth } from '../api.js';

const SUITE = ['IncServe', 'IncBot', 'IncScreen', 'IncVid', 'IncFeed', 'IncProctor'];

// Built-in demo account (seeded on the server). Shown on the sign-in screen so
// anyone can get in with one click.
const DEMO = { email: 'admin@incsource.com', password: 'incsource123' };

export function Auth({ onAuthed }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [form, setForm] = useState({ email: '', password: '', name: '', company: '', inviteCode: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const isReg = mode === 'register';

  async function doLogin(creds) {
    setErr('');
    setBusy(true);
    try {
      const res = isReg ? await api.register(creds) : await api.login(creds);
      if (res.error) { setErr(res.error); return; }
      auth.set(res.token);
      onAuthed(res.user);
    } catch {
      setErr('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function submit(e) {
    e.preventDefault();
    doLogin(isReg ? form : { email: form.email, password: form.password });
  }

  function useDemo() {
    setMode('login');
    setForm((f) => ({ ...f, email: DEMO.email, password: DEMO.password }));
    doLogin(DEMO);
  }

  return (
    <div className="auth-screen">
      <div className="auth-brand">
        <div className="auth-logo">in<span>Cruiter</span></div>
        <h1>IncSource</h1>
        <p className="auth-tag">Active Talent Sourcing — find candidates who are actually looking, match them to your JD with AI, and reach out, all in one place.</p>
        <div className="auth-suite">
          <span className="auth-suite-label">Part of the inCruiter suite</span>
          <div className="auth-suite-chips">
            {SUITE.map((s) => <span key={s} className="auth-chip">{s}</span>)}
          </div>
        </div>
      </div>

      <div className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          <h2>{isReg ? 'Create your account' : 'Welcome back'}</h2>
          <p className="auth-sub">{isReg ? 'Start sourcing active candidates in minutes.' : 'Sign in to your recruiter workspace.'}</p>

          {isReg && (
            <>
              <label className="field-label">Full name</label>
              <input className="input full" value={form.name} onChange={set('name')} placeholder="Asha Rao" autoComplete="name" />
              <label className="field-label">Company</label>
              <input className="input full" value={form.company} onChange={set('company')} placeholder="inCruiter" autoComplete="organization" />
              <label className="field-label">Team invite code <span className="muted sm">(optional)</span></label>
              <input className="input full" value={form.inviteCode} onChange={set('inviteCode')} placeholder="Paste a code to join your team — or leave blank to start a new workspace" autoComplete="off" />
            </>
          )}

          <label className="field-label">Work email</label>
          <input className="input full" type="email" value={form.email} onChange={set('email')} placeholder="you@company.com" autoComplete="email" required />

          <label className="field-label">Password</label>
          <input className="input full" type="password" value={form.password} onChange={set('password')} placeholder={isReg ? 'At least 8 characters' : '••••••••'} autoComplete={isReg ? 'new-password' : 'current-password'} required />

          {err && <div className="auth-err">{err}</div>}

          <button className="btn primary auth-submit" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : isReg ? 'Create account' : 'Sign in'}
          </button>

          <div className="auth-switch">
            {isReg ? 'Already have an account?' : 'New to IncSource?'}
            <button type="button" className="link-btn" onClick={() => { setMode(isReg ? 'login' : 'register'); setErr(''); }}>
              {isReg ? 'Sign in' : 'Create one'}
            </button>
          </div>

          {!isReg && (
            <div className="auth-demo">
              <div className="auth-demo-head">
                <span className="auth-demo-title">Demo login</span>
                <button type="button" className="btn sm" onClick={useDemo} disabled={busy}>Use demo account</button>
              </div>
              <div className="auth-demo-creds">
                <span><b>Email:</b> {DEMO.email}</span>
                <span><b>Password:</b> {DEMO.password}</span>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
