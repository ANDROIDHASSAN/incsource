// Email delivery. Uses your real SMTP when configured; otherwise spins up a
// nodemailer Ethereal test account so sends always work in dev and return a
// preview URL (nothing is delivered to real inboxes). Production = set SMTP_* env.
import nodemailer from 'nodemailer';

let transportP = null; // cached promise
let mode = 'unconfigured';
let fromAddr = process.env.EMAIL_FROM || 'sourcing@incruiter.com';
const fromName = process.env.EMAIL_FROM_NAME || 'InCruiter Sourcing';

async function buildTransport() {
  if (process.env.SMTP_HOST) {
    mode = 'smtp';
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  // Dev fallback — real send mechanics, fake inbox, preview link.
  const acct = await nodemailer.createTestAccount();
  mode = 'test';
  fromAddr = acct.user;
  return nodemailer.createTransport({
    host: 'smtp.ethereal.email', port: 587, secure: false,
    auth: { user: acct.user, pass: acct.pass },
  });
}

function getTransport() {
  if (!transportP) transportP = buildTransport().catch((e) => { transportP = null; throw e; });
  return transportP;
}

// Report delivery mode WITHOUT provisioning a transport. Whether we're "live"
// depends only on config (SMTP_HOST presence), so a status check (rendered on
// every page load) must never make a network call or spin up an Ethereal account
// — that only happens lazily on the first real send.
export function emailStatus() {
  if (process.env.SMTP_HOST) {
    return { configured: true, mode: 'smtp', from: `${fromName} <${fromAddr}>` };
  }
  return { configured: false, mode: 'test', from: `${fromName} <test-inbox@ethereal.email>` };
}

const FOOTER = '\n\n—\nSent via InCruiter · Reply STOP to opt out.';
const toHtml = (text) =>
  `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1c1f24;white-space:pre-wrap">${
    String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  }</div>`;

/** Send one email. Returns { ok, messageId, previewUrl?, error? }. */
export async function sendEmail({ to, subject, text }) {
  if (!to) return { ok: false, error: 'No recipient email' };
  try {
    const transport = await getTransport();
    const body = `${text}${FOOTER}`;
    const info = await transport.sendMail({
      from: `${fromName} <${fromAddr}>`,
      to, subject, text: body, html: toHtml(body),
    });
    return { ok: true, messageId: info.messageId, previewUrl: nodemailer.getTestMessageUrl(info) || null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
