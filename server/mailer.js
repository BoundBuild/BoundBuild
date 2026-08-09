/**
 * BoundBuild MVP — dispatch mailer.
 *
 * Delivery priority:
 *   1. Resend (transactional email API — one API key, no SMTP server needed)
 *   2. SMTP via nodemailer (SMTP_HOST etc. — any provider)
 *   3. Outbox fallback: dispatch record + branded .eml + recipient link + PDF
 *
 * Every dispatch carries the branded Commercial Event Record PDF attachment.
 *
 * Resend URL handling (v2):
 *   The endpoint is derived from RESEND_API_URL (default https://api.resend.com/v1)
 *   with automatic normalization: trailing slashes and a trailing '/emails' are
 *   stripped, so a misconfigured value can never produce '.../emails/emails'
 *   (which caused Resend HTTP 405). The effective endpoint is also surfaced in
 *   /api/admin/email-status and in error logs for easy diagnosis.
 */

const { outboxEmailHtml } = require('./emailTemplate');

function buildEml({ from, to, subject, html, attachments = [] }) {
  const boundary = 'bb-bound-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Date: ' + new Date().toUTCString(),
    'X-BoundBuild: dispatch',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
  ];
  for (const a of attachments) {
    lines.push(
      '',
      `--${boundary}`,
      `Content-Type: ${a.contentType || 'application/pdf'}; name="${a.filename}"`,
      `Content-Disposition: attachment; filename="${a.filename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      a.content.toString('base64'),
    );
  }
  lines.push('', `--${boundary}--`, '');
  return lines.join('\r\n');
}

/** Normalized Resend base URL — never includes a trailing slash or '/emails'. */
function resendBaseUrl() {
  const DEF = 'https://api.resend.com/v1';
  const raw = String(process.env.RESEND_API_URL || '').trim();
  if (!raw) return DEF;
  let base = raw.replace(/\/+$/, '').replace(/\/emails$/i, '');
  if (!/^https?:\/\/.+/.test(base)) return DEF;
  return base;
}

async function sendViaResend({ to, subject, html, attachments }) {
  const url = resendBaseUrl() + '/emails';
  const from = process.env.RESEND_FROM || process.env.SMTP_FROM || 'BoundBuild <onboarding@resend.dev>';
  const body = {
    from,
    to: [to],
    subject,
    html,
    attachments: attachments.map((a) => ({ filename: a.filename, content: a.content.toString('base64') })),
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.RESEND_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(`Resend HTTP ${res.status} [${url}]: ${text}`);
  }
  const data = await res.json();
  return { id: data.id };
}

async function sendViaSmtp({ to, subject, html, attachments }) {
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM || `BoundBuild <${process.env.SMTP_USER || 'events@boundbuild.app'}>`,
    to,
    subject,
    html,
    attachments: attachments.map((a) => ({ filename: a.filename, content: a.content })),
  });
  return { messageId: info.messageId };
}

/**
 * Send a dispatch email. Returns { status: 'sent'|'failed'|'queued', provider, error? }.
 */
async function sendEmail({ to, subject, html, attachments = [] }) {
  if (process.env.RESEND_API_KEY) {
    try {
      const info = await sendViaResend({ to, subject, html, attachments });
      return { status: 'sent', provider: 'resend', messageId: info.id };
    } catch (e) {
      console.error('Resend dispatch failed:', e.message);
      return { status: 'failed', provider: 'resend', error: e.message };
    }
  }
  if (process.env.SMTP_HOST) {
    try {
      await sendViaSmtp({ to, subject, html, attachments });
      return { status: 'sent', provider: 'smtp', host: process.env.SMTP_HOST };
    } catch (e) {
      console.error('SMTP dispatch failed:', e.message);
      return { status: 'failed', provider: 'smtp', error: e.message };
    }
  }
  return { status: 'queued', provider: 'outbox', error: null };
}

function emailConfig() {
  if (process.env.RESEND_API_KEY) {
    return {
      provider: 'resend', configured: true,
      from: process.env.RESEND_FROM || process.env.SMTP_FROM || 'BoundBuild <onboarding@resend.dev>',
      endpoint: resendBaseUrl() + '/emails',
    };
  }
  if (process.env.SMTP_HOST) {
    return { provider: 'smtp', configured: true, host: process.env.SMTP_HOST, from: process.env.SMTP_FROM || '' };
  }
  return { provider: 'outbox', configured: false };
}

function dispatchEmail({ event, project, to, recipientLink, fromName }) {
  const subject = `[BoundBuild] ${event.type} — ${event.title}`;
  const html = outboxEmailHtml({ event, project, recipientLink, fromName });
  return { subject, html };
}

module.exports = { buildEml, sendEmail, emailConfig, dispatchEmail, resendBaseUrl };
