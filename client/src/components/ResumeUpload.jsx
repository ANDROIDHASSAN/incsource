// Public, candidate-facing resume upload page (no login). Reached via the unique
// /r/:token link we put in outreach emails. The token authorizes the upload; the
// candidate drops their CV and it's attached + parsed onto their profile for us.
import { useEffect, useRef, useState } from 'react';
import { publicApi } from '../api.js';

export function ResumeUpload({ token }) {
  const [info, setInfo] = useState(null);       // { firstName, role, alreadyUploaded }
  const [loadErr, setLoadErr] = useState('');
  const [status, setStatus] = useState('idle'); // idle | uploading | done | error
  const [message, setMessage] = useState('');
  const [fileName, setFileName] = useState('');
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    publicApi.resumeInfo(token)
      .then((d) => { if (d.error) setLoadErr(d.error); else setInfo(d); })
      .catch(() => setLoadErr('This upload link could not be opened. Please check the link from your email.'));
  }, [token]);

  async function submit(file) {
    if (!file) return;
    const okType = /\.(pdf|docx?|txt)$/i.test(file.name);
    if (!okType) { setStatus('error'); setMessage('Please upload a PDF, Word (.docx) or text file.'); return; }
    if (file.size > 8 * 1024 * 1024) { setStatus('error'); setMessage('That file is over 8MB — please upload a smaller file.'); return; }
    setFileName(file.name);
    setStatus('uploading');
    setMessage('');
    try {
      const res = await publicApi.uploadResume(token, file);
      if (res.error) { setStatus('error'); setMessage(res.error); return; }
      setStatus('done');
      setMessage(res.message || 'Thanks! Your resume has been received.');
    } catch {
      setStatus('error');
      setMessage('Upload failed — please try again in a moment.');
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files?.[0];
    if (file) submit(file);
  }

  return (
    <div className="resume-page">
      <div className="resume-card">
        <div className="resume-brand"><span className="rb-in">in</span>Cruiter</div>

        {loadErr ? (
          <>
            <h1>Link not found</h1>
            <p className="resume-sub">{loadErr}</p>
          </>
        ) : !info ? (
          <p className="resume-sub">Loading…</p>
        ) : status === 'done' ? (
          <div className="resume-done">
            <div className="resume-check">✓</div>
            <h1>Resume received</h1>
            <p className="resume-sub">{message} You can close this page — our team will be in touch.</p>
          </div>
        ) : (
          <>
            <h1>Hi {info.firstName} 👋</h1>
            <p className="resume-sub">
              {info.role ? <>Thanks for your interest in the <b>{info.role}</b> role. </> : <>Thanks for your interest. </>}
              Please share your latest resume below — it takes a few seconds.
              {info.alreadyUploaded && <><br /><span className="muted">We already have one on file; uploading again will replace it.</span></>}
            </p>

            <div
              className={`resume-drop ${drag ? 'drag' : ''} ${status === 'uploading' ? 'busy' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
              onClick={() => status !== 'uploading' && inputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
            >
              <input ref={inputRef} type="file" accept=".pdf,.docx,.doc,.txt" hidden
                onChange={(e) => e.target.files[0] && submit(e.target.files[0])} />
              {status === 'uploading'
                ? <p>Uploading <b>{fileName}</b>…</p>
                : <p><b>Drop your resume here</b> or click to browse<br /><span className="muted">PDF or Word (.docx) · up to 8MB</span></p>}
            </div>

            {status === 'error' && <p className="resume-err">{message}</p>}
            <p className="resume-foot">Your resume is shared only with the hiring team that contacted you.</p>
          </>
        )}
      </div>
    </div>
  );
}
