'use strict';
/**
 * Outgoing email. Uses Resend's HTTP API when RESEND_API_KEY is set; otherwise
 * development prints the message to the console and tests keep an in-memory outbox.
 */
const config = require('../config');

const outbox = [];

async function send({ to, subject, text, html }) {
  if (config.isTest) {
    outbox.push({ to, subject, text, html, at: Date.now() });
    return { ok: true, test: true };
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (config.isProd) {
      console.error(`[mail] RESEND_API_KEY is not set - could not send "${subject}" to ${to}`);
      return { ok: false, reason: 'not_configured' };
    }
    console.log(`\n[mail] To: ${to}\n[mail] Subject: ${subject}\n${text}\n`);
    return { ok: true, logged: true };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM || `Sentinel <${config.brand.supportEmail}>`, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) {
      console.error(`[mail] Resend rejected "${subject}": HTTP ${res.status}`);
      return { ok: false, reason: `http_${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.error(`[mail] Could not reach Resend: ${err.message}`);
    return { ok: false, reason: 'unreachable' };
  }
}

/** Minimal, client-safe branded layout. */
function layout(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#0a0b0d;padding:40px 16px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#efece5">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
  <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#131519;border:1px solid #26292e;border-radius:18px">
  <tr><td style="padding:34px 32px">
    <div style="font-size:15px;font-weight:600;letter-spacing:.02em;color:#d4ae63;margin-bottom:24px">Sentinel</div>
    <h1 style="margin:0 0 14px;font-size:24px;font-weight:500;color:#efece5">${title}</h1>
    ${bodyHtml}
  </td></tr></table>
  <p style="color:#5f5e5a;font-size:12px;margin-top:18px">www.usesentinel.technology</p>
  </td></tr></table></body></html>`;
}

module.exports = { send, layout, outbox };
