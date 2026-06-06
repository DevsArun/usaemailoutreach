/* ============================================
   LeadForge AI — Job Processors
   Shared job logic used by BOTH the BullMQ workers
   (when Redis is available) and the in-process queue
   fallback (when Redis is NOT available).

   Centralising the logic here guarantees that every
   feature works identically whether or not a Redis
   instance is configured.
   ============================================ */

const {
  Email, Business, Review, WebsiteAnalysis, OutreachEmail, Followup,
} = require('../models');
const { processCampaign } = require('../services/campaignService');
const { verifyEmail } = require('../services/verificationService');
const { sendOutreachEmail, sendFollowupEmail } = require('../services/smtpService');
const { analyzeBusinessWithAI, generateOutreachEmail, matchServices } = require('../services/groqService');
const { callGroq } = require('../config/groq');
const logger = require('../utils/logger');

// ─── campaign-queue ──────────────────────────────────────────────────
async function processCampaignJob(data) {
  const { campaignId, userId } = data;
  await processCampaign(campaignId, userId);
}

// ─── analyze-queue ───────────────────────────────────────────────────
async function processAnalyzeJob(data) {
  const { businessId } = data;

  const business = await Business.findByPk(businessId, {
    include: [
      { model: Review, as: 'reviews', limit: 20 },
      { model: WebsiteAnalysis, as: 'website_analysis' },
    ],
  });

  if (!business) throw new Error(`Business ${businessId} not found`);

  const aiAnalysis = await analyzeBusinessWithAI(business, business.reviews, business.website_analysis);
  const services = await matchServices(business.website_analysis, aiAnalysis.pain_points);

  await business.update({
    lead_score: aiAnalysis.business_score || 50,
    ai_analysis: aiAnalysis,
    recommended_services: services,
    pain_points: aiAnalysis.pain_points || [],
    pipeline_stage: 'analyzed',
    pipeline_updated_at: new Date(),
  });

  logger.info(`Business analyzed: ${business.name} - Score: ${aiAnalysis.business_score}`);
}

// ─── verify-queue ────────────────────────────────────────────────────
async function processVerifyJob(data) {
  const { emailId, emailAddress } = data;

  const result = await verifyEmail(emailAddress);

  await Email.update({
    verification_status: result.status,
    verification_details: result.details,
    verified_at: new Date(),
  }, {
    where: { id: emailId },
  });

  logger.info(`Email verified: ${emailAddress} -> ${result.status}`);
}

// ─── email-queue (send outreach) ─────────────────────────────────────
async function processSendOutreachJob(data) {
  const { outreachId, userId } = data;
  await sendOutreachEmail(outreachId, userId);
}

// ─── email-queue (send follow-up) ────────────────────────────────────
async function processSendFollowupJob(data) {
  const { followupId, outreachId, userId } = data;
  await sendFollowupEmail(followupId, outreachId, userId);
}

// ─── outreach-queue (generate outreach) ──────────────────────────────
async function processGenerateOutreachJob(data) {
  const { businessId, campaignId } = data;

  const business = await Business.findByPk(businessId, {
    include: [
      { model: Review, as: 'reviews', limit: 10 },
      { model: WebsiteAnalysis, as: 'website_analysis' },
      { model: Email, as: 'emails', where: { verification_status: 'valid' }, required: false },
    ],
  });

  if (!business || !business.emails || business.emails.length === 0) {
    logger.warn(`No valid emails for business ${businessId}`);
    return;
  }

  const bestEmail = business.emails.find(e => e.type === 'owner')
    || business.emails.find(e => e.type === 'general')
    || business.emails[0];

  const emailContent = await generateOutreachEmail(
    business,
    business.reviews || [],
    business.website_analysis,
    business.ai_analysis || {}
  );

  await OutreachEmail.create({
    business_id: business.id,
    campaign_id: campaignId,
    email_id: bestEmail.id,
    to_email: bestEmail.email,
    subject: emailContent.subject,
    body: emailContent.body,
    status: 'draft',
    ai_context: {
      lead_score: business.lead_score,
      pain_points: business.pain_points,
      recommended_services: business.recommended_services,
    },
  });

  logger.info(`Outreach email generated for ${business.name}`);
}

// ─── followup-queue (generate follow-up) ─────────────────────────────
async function processGenerateFollowupJob(data) {
  const { outreachId } = data;

  const outreach = await OutreachEmail.findByPk(outreachId, {
    include: [
      { model: Business, as: 'business' },
      { model: Followup, as: 'followups' },
    ],
  });

  if (!outreach || outreach.status === 'replied') return;

  const sequenceNum = (outreach.followups || []).length + 1;
  const maxFollowups = parseInt(process.env.MAX_FOLLOWUPS) || 3;

  if (sequenceNum > maxFollowups) return;

  const followupBody = await callGroq([
    {
      role: 'system',
      content: `Generate a brief, professional follow-up email (#${sequenceNum}). Under 80 words. Reference the original context naturally. Return ONLY the email body.`,
    },
    {
      role: 'user',
      content: `Business: ${outreach.business.name}\nOriginal subject: ${outreach.subject}\nOriginal email: ${outreach.body}`,
    },
  ], { temperature: 0.8 });

  await Followup.create({
    outreach_id: outreach.id,
    sequence_number: sequenceNum,
    subject: `Re: ${outreach.subject}`,
    body: followupBody.trim(),
    status: 'draft',
    scheduled_at: new Date(Date.now() + sequenceNum * 3 * 24 * 60 * 60 * 1000),
  });

  logger.info(`Follow-up #${sequenceNum} generated for outreach ${outreach.id}`);
}

/**
 * Central dispatcher. Routes a (queueName, jobName, data) tuple to the
 * correct processor. Used by both BullMQ workers and the in-process queue.
 */
async function processJob(queueName, jobName, data) {
  switch (queueName) {
    case 'campaign-queue':
      return processCampaignJob(data);
    case 'analyze-queue':
      return processAnalyzeJob(data);
    case 'verify-queue':
      return processVerifyJob(data);
    case 'email-queue':
      if (jobName === 'send-followup') return processSendFollowupJob(data);
      return processSendOutreachJob(data);
    case 'outreach-queue':
      return processGenerateOutreachJob(data);
    case 'followup-queue':
      return processGenerateFollowupJob(data);
    default:
      throw new Error(`Unknown queue: ${queueName}`);
  }
}

module.exports = {
  processJob,
  processCampaignJob,
  processAnalyzeJob,
  processVerifyJob,
  processSendOutreachJob,
  processSendFollowupJob,
  processGenerateOutreachJob,
  processGenerateFollowupJob,
};
