// Resume / document text extraction. Pulls clean plain text out of an uploaded
// PDF, Word (.docx) or plain-text file, plus a light parse for contact details we
// can use to enrich the candidate (email + phone) when they hand us their CV.
// Shared by the public upload page and the recruiter's manual upload.

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
// A run that starts with an optional +, then digits with spaces/dots/dashes/parens
// between them — covers "+91 98765 43210", "+919876543210", "(080) 1234-5678",
// "98765 43210". We validate the digit count (10–13) afterwards so date ranges
// like "2018-2022" don't qualify.
const PHONE_RE = /\+?\d[\d\s().-]{8,16}\d/;

/**
 * Extract plain text from a document buffer.
 * @returns {Promise<string>} normalized text (throws with a friendly message on unreadable files)
 */
export async function extractDocText(buffer, filename = '', mimetype = '') {
  const name = String(filename).toLowerCase();
  let text = '';
  if (name.endsWith('.pdf') || mimetype === 'application/pdf') {
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
    text = (await pdfParse(buffer)).text || '';
  } else if (name.endsWith('.docx') || mimetype.includes('wordprocessingml')) {
    const mammoth = (await import('mammoth')).default;
    text = (await mammoth.extractRawText({ buffer })).value || '';
  } else if (name.endsWith('.doc')) {
    const err = new Error('Old .doc format isn’t supported — please save as PDF or .docx.');
    err.status = 422;
    throw err;
  } else {
    text = buffer.toString('utf8'); // .txt / plain text
  }
  text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

/** Light parse of a resume's text → the contact bits we can use to enrich a profile. */
export function parseResumeContacts(text = '') {
  const email = (String(text).match(EMAIL_RE) || [])[0] || null;
  const phoneRaw = (String(text).match(PHONE_RE) || [])[0] || null;
  // Keep a phone only when the digit count is phone-shaped (10–13), so years/ids
  // and short numeric runs don't get mistaken for a number.
  const phoneDigits = phoneRaw ? phoneRaw.replace(/\D/g, '').length : 0;
  const phone = phoneRaw && phoneDigits >= 10 && phoneDigits <= 13 ? phoneRaw.trim() : null;
  return { email, phone };
}

/** Build the candidate-facing resume object stored on the profile. */
export function buildResumeRecord({ text, filename, size, mimetype }) {
  const { email, phone } = parseResumeContacts(text);
  return {
    filename: String(filename || 'resume').slice(0, 200),
    size: Number(size) || (text ? Buffer.byteLength(text) : 0),
    mimetype: String(mimetype || '').slice(0, 100),
    // Cap stored text so a huge CV can't bloat a document; plenty for search/preview.
    text: String(text || '').slice(0, 60_000),
    parsedEmail: email,
    parsedPhone: phone,
    uploadedAt: new Date().toISOString(),
  };
}
