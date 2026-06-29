import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { Auth } from './components/Auth.jsx';
import { ResumeUpload } from './components/ResumeUpload.jsx';
import { api, auth } from './api.js';
import './styles.css';

// Public candidate-facing resume upload lives at /r/:token and must NOT require a
// recruiter login — short-circuit the auth flow when we're on that path.
const resumeMatch = window.location.pathname.match(/^\/r\/([A-Za-z0-9_-]+)\/?$/);

function Root() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  // On load, validate any stored token so a refresh keeps you signed in.
  useEffect(() => {
    const token = auth.get();
    if (!token) { setReady(true); return; }
    api.me()
      .then((d) => { if (d.user) setUser(d.user); else auth.clear(); })
      .catch(() => auth.clear())
      .finally(() => setReady(true));
  }, []);

  function logout() {
    auth.clear();
    setUser(null);
  }

  if (!ready) {
    return <div className="boot-screen"><div className="boot-spinner" /></div>;
  }
  if (!user) {
    return <Auth onAuthed={setUser} />;
  }
  return <App user={user} onLogout={logout} />;
}

// Cache the root on the container so Vite HMR re-running this module reuses the
// existing root instead of calling createRoot() twice (which logs a dev warning).
const container = document.getElementById('root');
const root = (container.__root ||= createRoot(container));
root.render(
  <React.StrictMode>
    {resumeMatch ? <ResumeUpload token={resumeMatch[1]} /> : <Root />}
  </React.StrictMode>
);
