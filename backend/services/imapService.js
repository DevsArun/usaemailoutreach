/* ============================================
   LeadForge AI — IMAP Inbound Reply Service
   Connects to each user's configured mailbox over IMAP,
   detects replies to previously-sent outreach emails,
   stores the reply text, marks the outreach as 'replied',
   auto-classifies it with Groq, and advances the pipeline.

   Designed to fail soft: any connection / parsing error is
   logged and skipped so the poller never crashes the app.
   ============================================ */

const { Op } = require('sequelize');
const { SmtpAccount, OutreachEmail, Business, Campaign } = require('../models');
const { classifyReply } = require('./groqService');
const logger = require('../utils/logger');

// Lazy-require so a missing optional dependency can never crash module load.
let ImapFlow = null;
let simpleParser = null;
function loadDeps() {
  if (!ImapFlow) {
    try {
      ImapFlow = require('imapflow').ImapFlow;
      simpleParser = require('mailparser').simpleParser;
    } catch (err) {
      logger.warn(`IMAP dependencies unavailable (${err.message}). Reply fetching disabled.`);
      return false;
    }
  }
  return true;
}

/**
 * Resolve IMAP connection settings for an SMTP account. Well-known providers
 * are mapped automatically; custom accounts may set imap_host/imap_port, and
 * otherwise we derive the IMAP host from the SMTP host.
 */
function imapConfigFor(account) {
  const provider = (account.provider || '').toLowerCase();

  if (account.imap_host) {
    return { host: account.imap_host, port: account.imap_port || 993, secure: true };
  }
  if (provider === 'gmail') {
    return { host: 'imap.gmail.com', port: 993, secure: true };
  }
  if (provider === 'outlook') {
    return { host: 'outlook.office365.com', port: 993, secure: true };
  }
  // Derive from the SMTP host as a best effort (smtp.x.com -> imap.x.com).
  if (account.host) {
    const derived = account.host.replace(/^smtp\./i, 'imap.');
    return { host: derived, port: 993, secure: true };
  }
  return null;
}

const RECONNECT_DENY = ['authenticationfailed', 'invalid credentials', 'auth'];

/**
 * Fetch and process replies for a single SMTP account.
 * Returns the number of newly-detected replies.
 */
async function fetchRepliesForAccount(account) {
  if (!loadDeps()) return 0;

  const cfg = imapConfigFor(account);
  if (!cfg || !cfg.host) {
    logger.warn(`No IMAP host resolvable for SMTP account ${account.email}; skipping.`);
    return 0;
  }

  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: account.email, pass: account.password },
    logger: false,
    tls: { rejectUnauthorized: false },
  });

  let newReplies = 0;
  let lock = null;

  try {
    await client.connect();
    lock = await client.getMailboxLock('INBOX');

    // Look back from the last successful check (or 14 days by default).
    const sinceDate = account.last_reply_check
      ? new Date(account.last_reply_check.getTime() - 60 * 60 * 1000) // 1h overlap
      : new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    let uids = [];
    try {
      uids = await client.search({ since: sinceDate }, { uid: true });
    } catch (e) {
      uids = [];
    }
    if (!Array.isArray(uids)) uids = [];

    // Cap how many messages we parse per run to bound resource usage.
    const MAX_MESSAGES = 200;
    if (uids.length > MAX_MESSAGES) uids = uids.slice(-MAX_MESSAGES);

    for (const uid of uids) {
      try {
        // Do NOT mark messages as seen (markSeen: false) — keep mailbox state.
        const msg = await client.fetchOne(uid, { source: true, envelope: true }, { uid: true });
        if (!msg || !msg.source) continue;

        const parsed = await simpleParser(msg.source);
        const fromAddr = (parsed.from?.value?.[0]?.address || '').toLowerCase().trim();
        const subject = parsed.subject || '';
        const text = (parsed.text || parsed.html || '').toString().trim();
        const when = parsed.date || new Date();

        const refs = [];
        if (parsed.inReplyTo) refs.push(...String(parsed.inReplyTo).split(/\s+/));
        if (parsed.references) {
          const r = Array.isArray(parsed.references) ? parsed.references : String(parsed.references).split(/\s+/);
          refs.push(...r);
        }
        const cleanRefs = refs.map(r => r.replace(/[<>]/g, '').trim()).filter(Boolean);

        const outreach = await matchOutreach(account, cleanRefs, fromAddr);
        if (!outreach) continue;
        if (outreach.status === 'replied') continue;

        await outreach.update({
          status: 'replied',
          replied_at: when,
          reply_text: text.slice(0, 10000),
        });
        newReplies++;

        // Auto-classify and advance the pipeline (best effort).
        try {
          const classification = await classifyReply(outreach.subject || subject, text);
          await outreach.update({ reply_classification: classification });

          if (['interested', 'send_pricing', 'call_me'].includes(classification) && outreach.business) {
            await outreach.business.update({
              pipeline_stage: classification === 'call_me' ? 'meeting_scheduled' : 'interested',
              pipeline_updated_at: new Date(),
            });
          } else if (outreach.business && ['discovered', 'analyzed', 'email_sent', 'opened'].includes(outreach.business.pipeline_stage)) {
            await outreach.business.update({ pipeline_stage: 'replied', pipeline_updated_at: new Date() });
          }
        } catch (clsErr) {
          logger.warn(`Reply classification failed for outreach ${outreach.id}: ${clsErr.message}`);
        }

        logger.info(`Reply detected for outreach ${outreach.id} from ${fromAddr}`);
      } catch (msgErr) {
        logger.debug(`Skipping message ${uid}: ${msgErr.message}`);
      }
    }

    await account.update({ last_reply_check: new Date(), status: 'active', error_message: null });
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (RECONNECT_DENY.some(d => msg.includes(d))) {
      // Bad credentials / IMAP not enabled — flag the account so the user knows.
      try {
        await account.update({ status: 'error', error_message: `IMAP: ${err.message}` });
      } catch (e) { /* ignore */ }
    }
    logger.warn(`IMAP fetch failed for ${account.email}: ${err.message}`);
  } finally {
    if (lock) { try { lock.release(); } catch (e) { /* ignore */ } }
    try { await client.logout(); } catch (e) { /* ignore */ }
  }

  return newReplies;
}

/**
 * Find the OutreachEmail (or its follow-up parent) that a reply belongs to.
 * Prefers matching by message-id references; falls back to matching the
 * sender address against an outreach we sent to (most recent, not yet replied).
 */
async function matchOutreach(account, cleanRefs, fromAddr) {
  // Only consider outreach belonging to this account's owner.
  const userScope = {
    model: Business,
    as: 'business',
    required: true,
    include: [{
      model: Campaign,
      as: 'campaign',
      required: true,
      where: { user_id: account.user_id },
      attributes: [],
    }],
  };

  if (cleanRefs.length) {
    const byRef = await OutreachEmail.findOne({
      where: { message_id: { [Op.in]: cleanRefs.map(r => `<${r}>`).concat(cleanRefs) } },
      include: [userScope],
    });
    if (byRef) return byRef;
  }

  if (fromAddr) {
    return OutreachEmail.findOne({
      where: {
        to_email: fromAddr,
        status: { [Op.in]: ['sent', 'delivered', 'opened'] },
      },
      include: [userScope],
      order: [['sent_at', 'DESC']],
    });
  }

  return null;
}

/**
 * Sync replies for all active SMTP accounts belonging to a single user.
 */
async function syncRepliesForUser(userId) {
  const accounts = await SmtpAccount.findAll({
    where: { user_id: userId, status: { [Op.in]: ['active', 'error'] } },
  });

  let total = 0;
  for (const account of accounts) {
    total += await fetchRepliesForAccount(account);
  }
  return { accountsChecked: accounts.length, newReplies: total };
}

/**
 * Sync replies for every active SMTP account in the system (used by the poller).
 */
async function syncAllReplies() {
  if (!loadDeps()) return { newReplies: 0 };

  const accounts = await SmtpAccount.findAll({
    where: { status: { [Op.in]: ['active', 'error'] } },
  });

  let total = 0;
  for (const account of accounts) {
    try {
      total += await fetchRepliesForAccount(account);
    } catch (err) {
      logger.warn(`syncAllReplies: account ${account.email} failed: ${err.message}`);
    }
  }

  if (accounts.length) {
    logger.info(`Reply sync complete: ${total} new repl${total === 1 ? 'y' : 'ies'} across ${accounts.length} mailbox(es).`);
  }
  return { accountsChecked: accounts.length, newReplies: total };
}

module.exports = {
  fetchRepliesForAccount,
  syncRepliesForUser,
  syncAllReplies,
  imapConfigFor,
};
