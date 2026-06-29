import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useEscapeClose } from '../useEscapeClose.js';

// Voice-to-voice control surface. STT via the browser Web Speech API (instant,
// on-device) with a Groq Whisper fallback for browsers that lack it; TTS via the
// browser SpeechSynthesis; a Groq "command brain" maps speech → app actions.
const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

function pickVoice() {
  if (!synth) return null;
  const vs = synth.getVoices() || [];
  return (
    vs.find((v) => /Daniel/i.test(v.name)) ||
    vs.find((v) => /Google UK English Male/i.test(v.name)) ||
    vs.find((v) => /Microsoft (Guy|Ryan|George)/i.test(v.name)) ||
    vs.find((v) => /en-GB/i.test(v.lang)) ||
    vs.find((v) => /^en[-_]/i.test(v.lang)) ||
    vs[0] || null
  );
}

// Reactive holographic orb — colour by state, radius/glow by mic amplitude.
function paintOrb(canvas, level, state, t) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, base = Math.min(w, h) * 0.17;
  const [r, g, b] =
    state === 'listening' ? [56, 189, 248] :
    state === 'thinking' ? [167, 139, 250] :
    state === 'speaking' ? [52, 211, 153] :
    state === 'error' ? [248, 113, 113] : [96, 165, 250];
  const lv = level;
  const glow = base * (1.7 + lv * 1.6);
  const grad = ctx.createRadialGradient(cx, cy, base * 0.2, cx, cy, glow);
  grad.addColorStop(0, `rgba(${r},${g},${b},0.45)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(cx, cy, glow, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 3; i++) {
    const rad = base * (1.15 + i * 0.3) + lv * base * 0.6 * (i + 1);
    ctx.beginPath();
    ctx.strokeStyle = `rgba(${r},${g},${b},${0.5 - i * 0.13})`;
    ctx.lineWidth = 2;
    const a = t * (0.5 + i * 0.5) * (i % 2 ? 1 : -1);
    ctx.arc(cx, cy, rad, a, a + Math.PI * 1.35);
    ctx.stroke();
  }
  const core = base * (0.78 + lv * 0.55);
  const cg = ctx.createRadialGradient(cx - core * 0.3, cy - core * 0.3, core * 0.1, cx, cy, core);
  cg.addColorStop(0, 'rgba(255,255,255,0.96)');
  cg.addColorStop(0.5, `rgba(${r},${g},${b},0.92)`);
  cg.addColorStop(1, `rgba(${r},${g},${b},0.35)`);
  ctx.fillStyle = cg;
  ctx.beginPath(); ctx.arc(cx, cy, core, 0, Math.PI * 2); ctx.fill();
}

const STATUS = {
  idle: 'Tap the orb or say “Jarvis”', listening: 'Listening…', thinking: 'Thinking…',
  speaking: 'Speaking…', error: 'Mic unavailable',
};

export function Jarvis({ onClose, onCommand, toast, minimized = false, onRestore }) {
  const [state, setState] = useState('idle');
  const [partial, setPartial] = useState('');
  const [reply, setReply] = useState('Online. How can I help you source?');
  const [log, setLog] = useState([]);
  const [wake, setWake] = useState(false);
  const [muted, setMuted] = useState(false);

  const canvasRef = useRef(null);
  const recogRef = useRef(null);
  const streamRef = useRef(null);
  const analyserRef = useRef(null);
  const levelRef = useRef(0);
  const finalRef = useRef('');
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const audioRef = useRef(null); // currently-playing neural-voice clip
  const stateRef = useRef('idle'); stateRef.current = state;
  const wakeRef = useRef(false); wakeRef.current = wake;
  const mutedRef = useRef(false); mutedRef.current = muted;

  useEscapeClose(() => { stopEverything(); onClose(); });
  const pushLog = (who, text) => setLog((l) => [...l.slice(-24), { who, text, id: (l[l.length - 1]?.id || 0) + 1 }]);

  // ── mic stream + holographic visualizer ──
  useEffect(() => {
    let raf;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ac = new Ctx();
        const an = ac.createAnalyser();
        an.fftSize = 256;
        ac.createMediaStreamSource(stream).connect(an);
        analyserRef.current = an;
      } catch {
        if (!SR) setState('error'); // no visualizer mic AND no web-speech → nothing to capture with
      }
    })();
    const loop = () => {
      const an = analyserRef.current;
      let lvl = 0;
      if (an) {
        const data = new Uint8Array(an.frequencyBinCount);
        an.getByteFrequencyData(data);
        let s = 0; for (let i = 0; i < data.length; i++) s += data[i];
        lvl = Math.min(1, s / data.length / 105);
      }
      levelRef.current = levelRef.current * 0.82 + lvl * 0.18;
      if (canvasRef.current) paintOrb(canvasRef.current, levelRef.current, stateRef.current, Date.now() / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    if (synth) { synth.getVoices(); synth.onvoiceschanged = () => synth.getVoices(); }
    // greet
    const greet = setTimeout(() => speak('JARVIS online. Say “Jarvis”, or tap the orb and tell me who to source.'), 500);
    return () => { cancelAnimationFrame(raf); clearTimeout(greet); stopEverything(); };
    // eslint-disable-next-line
  }, []);

  function stopEverything() {
    try { recogRef.current?.abort?.(); } catch { /* ignore */ }
    try { synth?.cancel(); } catch { /* ignore */ }
    stopAudio();
    try { if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); } catch { /* ignore */ }
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
  }

  // Tear down any in-flight neural-voice playback and free its object URL.
  function stopAudio() {
    const a = audioRef.current;
    if (!a) return;
    audioRef.current = null;
    try { a.onended = a.onerror = null; a.pause(); } catch { /* ignore */ }
    try { URL.revokeObjectURL(a.src); } catch { /* ignore */ }
  }

  // ── Web Speech recognizer ──
  function ensureRecognizer() {
    if (recogRef.current) return recogRef.current;
    const r = new SR();
    r.lang = 'en-US'; r.continuous = false; r.interimResults = true; r.maxAlternatives = 1;
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const tr = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalRef.current += tr + ' '; else interim += tr;
      }
      setPartial((finalRef.current + interim).trim());
    };
    r.onerror = (e) => { if (!['no-speech', 'aborted', 'audio-capture'].includes(e.error)) toast?.(`Voice: ${e.error}`, 'err'); afterListen(); };
    r.onend = () => afterListen();
    recogRef.current = r;
    return r;
  }

  function startListening() {
    if (stateRef.current === 'listening' || stateRef.current === 'thinking') return;
    setPartial(''); finalRef.current = '';
    if (SR) {
      const r = ensureRecognizer();
      setState('listening');
      try { r.start(); } catch { /* already running */ }
    } else {
      startRecorder();
    }
  }
  function stopListening() {
    try { recogRef.current?.stop(); } catch { /* ignore */ }
    try { if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); } catch { /* ignore */ }
  }

  function afterListen() {
    if (stateRef.current !== 'listening') return;
    const text = finalRef.current.trim();
    finalRef.current = '';
    if (!text) { wakeRef.current ? relisten() : setState('idle'); return; }
    if (wakeRef.current) {
      const m = text.toLowerCase().match(/(?:hey\s+)?(?:jarvis|jervis|charvis|service)\b[,.!]?\s*(.*)/i);
      if (!m) { relisten(); return; }            // no wake word → keep waiting
      process((m[1] || '').trim() || 'yes?');
    } else {
      process(text);
    }
  }
  const relisten = () => { setState('idle'); setTimeout(() => wakeRef.current && startListening(), 350); };

  // ── Whisper (Groq) fallback when Web Speech is missing ──
  function startRecorder() {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === 'undefined') { toast?.('Voice capture unavailable in this browser', 'err'); setState('error'); return; }
    chunksRef.current = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
    rec.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
      if (blob.size < 800) { setState('idle'); return; }
      setState('thinking');
      try {
        const { text, error } = await api.voiceTranscribe(blob);
        if (error) throw new Error(error);
        text ? process(text) : setState('idle');
      } catch (e) { toast?.(e.message || 'Transcription failed', 'err'); setState('idle'); }
    };
    recorderRef.current = rec;
    rec.start();
    setState('listening');
  }

  // ── command brain → execute → speak ──
  async function process(text) {
    setState('thinking'); setPartial('');
    pushLog('you', text);
    let res;
    try { res = await api.voiceCommand(text); }
    catch { res = { action: 'say', speak: 'Sorry, I lost the connection there.' }; }
    let spoken = res.speak;
    try {
      const fromApp = await onCommand?.({ action: res.action, params: res.params || {} });
      if (typeof fromApp === 'string' && fromApp.trim()) spoken = fromApp;
    } catch { /* app handler best-effort */ }
    if (res.action === 'stop') { setWake(false); wakeRef.current = false; speak(spoken || 'Standing by.'); return; }
    speak(spoken);
  }

  // Speak a reply. Primary path is the neural Groq voice (consistent on every
  // browser); if that's unavailable we fall back to the browser's on-device synth.
  async function speak(text) {
    setReply(text); pushLog('jarvis', text);
    setState('speaking');
    if (mutedRef.current) { afterSpeak(); return; }
    try { synth?.cancel(); } catch { /* ignore */ }
    stopAudio();
    let blob;
    try {
      blob = await api.voiceSpeak(text);
    } catch {
      browserSpeak(text); // no neural voice (no key / model terms) → on-device
      return;
    }
    if (mutedRef.current) { afterSpeak(); return; } // muted while synthesizing
    try {
      const audio = new Audio(URL.createObjectURL(blob));
      audioRef.current = audio;
      audio.onended = () => { stopAudio(); afterSpeak(); };
      audio.onerror = () => { stopAudio(); browserSpeak(text); };
      await audio.play();
    } catch {
      // Autoplay blocked or decode error — fall back to the browser voice.
      stopAudio();
      browserSpeak(text);
    }
  }

  // On-device fallback voice (Chromium picks a British-male voice for the JARVIS feel).
  function browserSpeak(text) {
    if (!synth || mutedRef.current) { afterSpeak(); return; }
    try {
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05; u.pitch = 0.95; u.volume = 1;
      const v = pickVoice(); if (v) u.voice = v;
      u.onend = afterSpeak; u.onerror = afterSpeak;
      synth.speak(u);
    } catch { afterSpeak(); }
  }
  const afterSpeak = () => { wakeRef.current ? relisten() : setState('idle'); };

  function toggleListen() {
    if (stateRef.current === 'speaking') { synth?.cancel(); stopAudio(); afterSpeak(); }
    if (stateRef.current === 'listening') stopListening();
    else if (stateRef.current !== 'thinking') startListening();
  }
  function toggleWake() {
    const next = !wake;
    setWake(next); wakeRef.current = next;
    if (next) { toast?.('Wake word on — say “Jarvis …”', 'ok'); startListening(); }
    else stopListening();
  }
  function toggleMute() {
    const n = !muted; setMuted(n);
    if (n) { synth?.cancel(); stopAudio(); if (stateRef.current === 'speaking') afterSpeak(); }
  }

  // Minimized: a small floating orb pill so the main orchestration stage is visible
  // while JARVIS keeps listening/speaking. The mic + recognizer effects keep running
  // (they live in refs, independent of which view renders), so voice is uninterrupted.
  if (minimized) {
    return (
      <div className="jarvis-mini" onClick={onRestore} title="Expand JARVIS">
        <canvas ref={canvasRef} className="jarvis-orb" />
        <div className="jmini-text">
          <span className="jmini-state">JARVIS · {(STATUS[state] || '').replace('…', '') || 'idle'}</span>
          <span className="jmini-cap">{partial ? `“${partial}”` : reply}</span>
        </div>
        <button className="jmini-expand" onClick={(e) => { e.stopPropagation(); onRestore?.(); }}>Expand</button>
      </div>
    );
  }

  return (
    <div className="jarvis-overlay" onClick={(e) => { if (e.target === e.currentTarget) toggleListen(); }}>
      <button className="jarvis-x" onClick={() => { stopEverything(); onClose(); }} aria-label="Close">×</button>

      <div className="jarvis-stage">
        <div className="jarvis-brand"><span className="jdot" /> J.A.R.V.I.S · Sourcing AI</div>

        <div className={`jarvis-orb-wrap ${state}`} onClick={toggleListen} title="Tap to talk">
          <canvas ref={canvasRef} className="jarvis-orb" />
          <div className="jarvis-status">{STATUS[state] || ''}</div>
        </div>

        <div className="jarvis-caption">
          {partial ? <span className="jcap-you">“{partial}”</span> : <span className="jcap-jarvis">{reply}</span>}
        </div>

        <div className="jarvis-log">
          {log.slice(-5).map((l) => (
            <div key={l.id} className={`jlog ${l.who}`}><b>{l.who === 'you' ? 'You' : 'JARVIS'}</b>{l.text}</div>
          ))}
        </div>

        <div className="jarvis-controls">
          <button className={`jbtn ${state === 'listening' ? 'live' : ''}`} onClick={toggleListen}>
            {state === 'listening' ? '■ Stop' : '🎙 Talk'}
          </button>
          <button className={`jbtn ${wake ? 'on' : ''}`} onClick={toggleWake} title="Hands-free: say “Jarvis …”">
            {wake ? '👂 Wake: on' : '👂 Wake word'}
          </button>
          <button className={`jbtn ${muted ? 'on' : ''}`} onClick={toggleMute}>{muted ? '🔇 Muted' : '🔊 Voice'}</button>
        </div>

        <div className="jarvis-hints">
          Try: “Jarvis, find 6 React developers in Pune” · “show me hot candidates” · “read the results” · “what’s my usage”
        </div>
      </div>
    </div>
  );
}
