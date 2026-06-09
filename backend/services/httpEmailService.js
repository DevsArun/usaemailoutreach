/* ============================================
   LeadForge AI — HTTP Email Service
   --------------------------------------------
   Sends email over HTTPS (port 443) using a
   transactional email provider's REST API.

   WHY THIS EXISTS:
   Hosting platforms like Hugging Face Spaces,
   Render, and Railway block outbound SMTP ports
   (25, 465, 587). Raw SMTP (nodemailer) therefore
   fails with "Connection timeout". HTTPS (443) is
   NOT blocked, so sending via a provider API works.

   ACTIVATION (set as Space Secrets / env vars):
     EMAIL_HTTP_PROVIDER=brevo        # or "resend"
     BREVO_API_KEY=xkeysib-...        # if using brevo
     RESEND_API_KEY=re_...            # if using resend

   When EMAIL_HTTP_PROVIDER is unset/empty, the app
   falls back to normal SMTP (works on a VPS).
   ============================================ */

const axios = require('axios');
const logger = require('../utils/logger');

function getProvider() {
  return (process.env.EMAIL_HTTP_PROVIDER || '').trim().toLowerCase();
}

function isHttpProviderEnabled() {
  const provider = getProvider();
  if (provider === 'brevo') return !!process.env.BREVO_API_KEY;
  if (provider === 'resend') return !!process.env.RESEND_API_KEY;
  return false;
}

function extractError(error) {
  if (error.response && error.response.data) {
    const d = error.response.data;
    const msg = d.message || d.error || (d.name ? `${d.name}: ${d.message || ''}` : null);
    return `${error.response.status} ${msg || JSON.stringify(d)}`;
  }
  if (error.code === 'ECONNABORTED') return 'Request timed out contacting email API';
  return error.message;
}

// ─── BREVO (https://api.brevo.com) ───────────────────────────────────
async function sendViaBrevo({ fromEmail, fromName, to, subject, html, text, replyTo, headers }) {
  const res = await axios.post(
    'https://api.brevo.com/v3/smtp/email',
    {
      sender: { name: fromName || fromEmail, email: fromEmail },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
      ...(replyTo ? { replyTo: { email: replyTo } } : {}),
      ...(headers ? { headers } : {}),
    },
    {
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      timeout: 20000,
    }
  );
  return { messageId: res.data && res.data.messageId };
}

async function verifyBrevo() {
  await axios.get('https://api.brevo.com/v3/account', {
    headers: { 'api-key': process.env.BREVO_API_KEY, accept: 'application/json' },
    timeout: 15000,
  });
  return true;
}

// ─── RESEND (https://api.resend.com) ─────────────────────────────────
async function sendViaResend({ fromEmail, fromName, to, subject, html, text, replyTo, headers }) {
  const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
  const res = await axios.post(
    'https://api.resend.com/emails',
    {
      from,
      to: [to],
      subject,
      html,
      text,
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(headers ? { headers } : {}),
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      timeout: 20000,
    }
  );
  return { messageId: res.data && res.data.id };
}

async function verifyResend() {
  await axios.get('https://api.resend.com/domains', {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    timeout: 15000,
  });
  return true;
}

// ─── PUBLIC API ──────────────────────────────────────────────────────
async function sendViaHttp(params) {
  const provider = getProvider();
  try {
    let result;
    if (provider === 'brevo') result = await sendViaBrevo(params);
    else if (provider === 'resend') result = await sendViaResend(params);
    else throw new Error('No HTTP email provider configured');

    logger.info(`HTTP email sent via ${provider} to ${params.to} (messageId: ${result.messageId})`);
    return result;
  } catch (error) {
    const message = extractError(error);
    logger.error(`HTTP email send failed via ${provider}: ${message}`);
    throw new Error(message);
  }
}

async function verifyHttpProvider() {
  const provider = getProvider();
  try {
    if (provider === 'brevo') return await verifyBrevo();
    if (provider === 'resend') return await verifyResend();
    throw new Error('No HTTP email provider configured');
  } catch (error) {
    throw new Error(extractError(error));
  }
}

module.exports = {
  getProvider,
  isHttpProviderEnabled,
  sendViaHttp,
  verifyHttpProvider,
};
