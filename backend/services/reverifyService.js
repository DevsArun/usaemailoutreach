/* ============================================
   LeadForge AI — Re-verify & Generate
   On-demand: re-verify all pending/risky emails for a user, keep only the
   valid ones, then queue AI outreach generation for every business that now
   has a valid email but no outreach draft yet.
   ============================================ */

const { Op } = require('sequelize');
const { Email, Business, Campaign, OutreachEmail } = require('../models');
const { verifyEmail } = require('./verificationService');
const { enqueue } = require('../queues');
const logger = require('../utils/logger');

async function reverifyAndGenerate(userId, campaignId) {
  // ── 1. Re-verify every not-yet-valid email belonging to this user ──
  const pending = await Email.findAll({
    where: { verification_status: { [Op.in]: ['pending', 'risky', 'catch_all', 'invalid'] } },
    include: [{
      model: Business,
      as: 'business',
      required: true,
      attributes: ['id', 'campaign_id'],
      include: [{
        model: Campaign,
        as: 'campaign',
        required: true,
        attributes: [],
        where: { user_id: userId, ...(campaignId ? { id: campaignId } : {}) },
      }],
    }],
  });

  let verified = 0;
  let removed = 0;
  for (const em of pending) {
    let result;
    try {
      result = await verifyEmail(em.email);
    } catch (e) {
      result = { status: 'risky', details: { error: e.message } };
    }

    if (result.status === 'valid') {
      await em.update({
        verification_status: 'valid',
        verification_details: result.details || {},
        verified_at: new Date(),
      });
      verified++;
    } else {
      // Honour "only verified emails stay in the DB".
      try { await em.destroy(); removed++; } catch (e) { /* ignore */ }
    }
  }

  // ── 2. Queue AI outreach for businesses that now have a valid email ──
  const businesses = await Business.findAll({
    where: campaignId ? { campaign_id: campaignId } : {},
    attributes: ['id', 'campaign_id'],
    include: [
      { model: Campaign, as: 'campaign', required: true, attributes: [], where: { user_id: userId } },
      { model: Email, as: 'emails', required: true, attributes: ['id'], where: { verification_status: 'valid' } },
    ],
  });

  let outreachQueued = 0;
  for (const biz of businesses) {
    const existing = await OutreachEmail.count({ where: { business_id: biz.id } });
    if (existing > 0) continue; // don't duplicate drafts
    await enqueue('outreach-queue', 'generate-outreach', {
      businessId: biz.id,
      campaignId: biz.campaign_id,
    });
    outreachQueued++;
  }

  logger.info(`Re-verify (user ${userId}): ${verified} valid, ${removed} removed, ${outreachQueued} outreach queued`);
  return { verified, removed, outreachQueued };
}

module.exports = { reverifyAndGenerate };
