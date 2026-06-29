// Speech-to-text via Groq Whisper (whisper-large-v3-turbo) — the fallback STT for
// browsers that lack the Web Speech API. Node 18+ provides global fetch/FormData/Blob.
import { config, usingAI } from '../config.js';
import { usage } from './usage.js';

const WHISPER_MODEL = process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo';

const extFor = (ct = '') =>
  /wav/.test(ct) ? 'wav' : /mp3|mpeg/.test(ct) ? 'mp3' : /ogg/.test(ct) ? 'ogg' : /m4a|mp4/.test(ct) ? 'm4a' : 'webm';

/** Transcribe an audio buffer → { text } or { error }. */
export async function transcribeAudio(buffer, contentType = 'audio/webm') {
  if (!usingAI()) {
    return { error: 'Voice transcription needs a Groq key (Tools → API keys), or use a Chromium browser which transcribes on-device.' };
  }
  try {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: contentType }), `audio.${extFor(contentType)}`);
    form.append('model', WHISPER_MODEL);
    form.append('response_format', 'json');
    form.append('temperature', '0');
    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.groq.key}` },
      body: form,
    });
    usage.incGroq();
    if (!res.ok) return { error: `Groq STT ${res.status}: ${(await res.text()).slice(0, 160)}` };
    const data = await res.json();
    return { text: String(data.text || '').trim() };
  } catch (e) {
    return { error: e.message || 'transcription failed' };
  }
}

// ── Text-to-speech via Groq Orpheus (neural, human-sounding) ──────────────────
// Gives JARVIS a real voice on every browser, replacing the robotic on-device
// SpeechSynthesis. Returns { audio: Buffer, contentType } or { error }.
const VALID_VOICES = ['autumn', 'diana', 'hannah', 'austin', 'daniel', 'troy'];

export async function synthesizeSpeech(text, voice) {
  if (!usingAI()) {
    return { error: 'Voice needs a Groq key (Tools → API keys).' };
  }
  // Orpheus has a per-request input ceiling; keep replies short and trim hard.
  const input = String(text || '').trim().slice(0, 1200);
  if (!input) return { error: 'no text to speak' };
  const v = VALID_VOICES.includes(String(voice)) ? voice : config.groq.ttsVoice;
  try {
    const res = await fetch('https://api.groq.com/openai/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.groq.key}` },
      body: JSON.stringify({ model: config.groq.ttsModel, input, voice: v, response_format: 'wav' }),
    });
    usage.incGroq();
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      // First-time use of the Orpheus model may require accepting its terms once in
      // the Groq console — surface that clearly so it's an easy fix, not a mystery.
      const hint = /terms|accept|403/.test(detail) || res.status === 403
        ? ' — open console.groq.com, accept the Orpheus model terms once, then retry.'
        : '';
      return { error: `Groq TTS ${res.status}: ${detail}${hint}` };
    }
    const audio = Buffer.from(await res.arrayBuffer());
    return { audio, contentType: res.headers.get('content-type') || 'audio/wav' };
  } catch (e) {
    return { error: e.message || 'speech synthesis failed' };
  }
}
