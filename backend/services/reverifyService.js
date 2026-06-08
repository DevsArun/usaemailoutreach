/* ============================================
   LeadForge AI — Re-verify, Re-discover & Generate
   On-demand from the Lead Explorer:
   1) Re-verify any not-yet-valid emails (keep valid, drop the rest).
   2) Re-crawl the website of every business that has NO valid email yet
      to find new ones (then verify + keep only valid).
   3) Queue AI outreach generation for every business that now has a valid
      email but no outreach draft.
   Business-website crawling is NOT IP-blocked (unlike Google Maps), so this
   works on cloud hosts.
   ============================================ */

const axios = require('axios');
const { Op } = require('sequelize');
const { Email, Business, Campaign, OutreachEmail } = require('../models');
const { verifyEmail } = require('./verificationService');
const { enqueue } = require('../queues');
const logger = require('../utils/logger');

const SCRAPER_URL = process.env.SCRAPER_SERVICE_URL || 'http://localhost:8000';

// Crawl a single business website for emails, verify them, and store only valid.
async function discoverForBusiness(business) {
  if (!business.website) return 0;
  const url = business.website.startsWith('http') ? business.website : `https://${business.website}`;

  let found = [];
  try {
    const resp = await axios.post(`${SCRAPER_URL}/discover/emails`, { url, max_pages: 5 }, { timeout: 120000 });
    found = (resp.data && resp.data.emails) || [];
  } catch (e) {
    return 0;
  }

  let stored = 0;
  for (const em of found) {
    const addr = (em.email || '').toLowerCase().trim();
    if (!addr) continue;
    const existing = await Email.findOne({ where: { business_id: business.id, email: addr } });
    if (existing) continue;

    let v;
    try { v = await verifyEmail(addr); } catch (e) { v = { status: 'risky', details: {} }; }
    if (v.status !== 'valid') continue;

    await Email.create({
      business_id: business.id,
      email: addr,
      type: em.type || 'general',
      source: em.source_page || business.website,
      verification_status: 'valid',
      verification_details: v.details || {},
      verified_at: new Date(),
    });
    stored++;
  }
  return stored;
}

async function reverifyAndGenerate(userId, campaignId) {
  // Resolve this user's campaign + business scope reliably (avoids fragile
  // nested-include counts).
  const campWhere = { user_id: userId, ...(campaignId ? { id: campaignId } : {}) };
  const campaigns = await Campaign.findAll({ where: campWhere, attributes: ['id'], raw: true });
  const campaignIds = campaigns.map(c => c.id);
  if (campaignIds.length === 0) return { verified: 0, removed: 0, discovered: 0, outreachQueued: 0 };

  const businesses = await Business.findAll({
    where: { campaign_id: { [Op.in]: campaignIds } },
    attributes: ['id', 'campaign_id', 'website'],
    raw: true,
  });
  const businessIds = businesses.map(b => b.id);
  if (businessIds.length === 0) return { verified: 0, removed: 0, discovered: 0, outreachQueued: 0 };

  // ── 1. Re-verify existing not-yet-valid emails ──
  const pending = await Email.findAll({
    where: {
      business_id: { [Op.in]: businessIds },
      verification_status: { [Op.in]: ['pending', 'risky', 'catch_all', 'invalid'] },
    },
  });
  let verified = 0;
  let removed = 0;
  for (const em of pending) {
    let result;
    try { result = await verifyEmail(em.email); } catch (e) { result = { status: 'risky', details: {} }; }
    if (result.status === 'valid') {
      await em.update({ verification_status: 'valid', verification_details: result.details || {}, verified_at: new Date() });
      verified++;
    } else {
      try { await em.destroy(); removed++; } catch (e) { /* ignore */ }
    }
  }

  // ── 2. Re-discover emails for businesses that still have NO valid email ──
  const validEmails = await Email.findAll({
    where: { business_id: { [Op.in]: businessIds }, verification_status: 'valid' },
    attributes: ['business_id'],
    raw: true,
  });
  const haveValid = new Set(validEmails.map(e => e.business_id));

  const needEmail = businesses.filter(b => b.website && !haveValid.has(b.id));
  let discovered = 0;
  // Bound the work so a huge list doesn't run forever in the background.
  for (const b of needEmail.slice(0, 100)) {
    try {
      const n = await discoverForBusiness(b);
      if (n > 0) { discovered += n; haveValid.add(b.id); }
    } catch (e) { /* ignore individual failures */ }
  }

  // ── 3. Queue AI outreach for businesses that now have a valid email & no draft ──
  const withValid = await Business.findAll({
    where: { campaign_id: { [Op.in]: campaignIds } },
    attributes: ['id', 'campaign_id'],
    include: [{ model: Email, as: 'emails', required: true, attributes: ['id'], where: { verification_status: 'valid' } }],
  });

  let outreachQueued = 0;
  for (const biz of withValid) {
    const existing = await OutreachEmail.count({ where: { business_id: biz.id } });
    if (existing > 0) continue;
    await enqueue('outreach-queue', 'generate-outreach', { businessId: biz.id, campaignId: biz.campaign_id });
    outreachQueued++;
  }

  logger.info(`Re-verify (user ${userId}): ${verified} re-verified, ${removed} removed, ${discovered} newly discovered, ${outreachQueued} outreach queued`);
  return { verified, removed, discovered, outreachQueued };
}

module.exports = { reverifyAndGenerate };
