const { Worker } = require('bullmq');
const { createRedisConnection } = require('../../config/redis');
const { processCampaign } = require('../../services/campaignService');
const { verifyEmail } = require('../../services/verificationService');
const { sendOutreachEmail, sendFollowupEmail } = require('../../services/smtpService');
const { analyzeBusinessWithAI, generateOutreachEmail, matchServices } = require('../../services/groqService');
const { Email, Business, Review, WebsiteAnalysis, OutreachEmail, Followup, Campaign, AnalyticsEvent } = require('../../models');
const logger = require('../../utils/logger');

let workers = [];

async function initWorkers() {
  const connection = createRedisConnection();

  const campaignWorker = new Worker('campaign-queue', async (job) => {
    logger.info(`Processing campaign job: ${job.id}`);
    const { campaignId, userId } = job.data;
    await processCampaign(campaignId, userId);
  }, {
    connection,
    concurrency: 2,
    limiter: { max: 2, duration: 1000 },
  });

  const analyzeWorker = new Worker('analyze-queue', async (job) => {
    logger.info(`Processing analyze job: ${job.id}`);
    const { businessId } = job.data;

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
  }, {
    connection,
    concurrency: 5,
    limiter: { max: 10, duration: 60000 },
  });

  const verifyWorker = new Worker('verify-queue', async (job) => {
    logger.info(`Processing verify job: ${job.id}`);
    const { emailId, emailAddress } = job.data;

    const result = await verifyEmail(emailAddress);

    await Email.update({
      verification_status: result.status,
      verification_details: result.details,
      verified_at: new Date(),
    }, {
      where: { id: emailId },
    });

    logger.info(`Email verified: ${emailAddress} → ${result.status}`);
  }, {
    connection,
    concurrency: 3,
    limiter: { max: 5, duration: 10000 },
  });

  const emailWorker = new Worker('email-queue', async (job) => {
    logger.info(`Processing email job: ${job.id} - ${job.name}`);

    if (job.name === 'send-outreach') {
      const { outreachId, userId } = job.data;
      await sendOutreachEmail(outreachId, userId);
    } else if (job.name === 'send-followup') {
      const { followupId, outreachId, userId } = job.data;
      await sendFollowupEmail(followupId, outreachId, userId);
    }
  }, {
    connection,
    concurrency: 1,
    limiter: { max: 1, duration: 2000 },
  });

  const outreachWorker = new Worker('outreach-queue', async (job) => {
    logger.info(`Processing outreach generation job: ${job.id}`);
    const { businessId, campaignId } = job.data;

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
  }, {
    connection,
    concurrency: 3,
    limiter: { max: 10, duration: 60000 },
  });

  const followupWorker = new Worker('followup-queue', async (job) => {
    logger.info(`Processing followup job: ${job.id}`);
    const { outreachId } = job.data;

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

    const { callGroq } = require('../../config/groq');
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
  }, {
    connection,
    concurrency: 3,
  });

  workers = [campaignWorker, analyzeWorker, verifyWorker, emailWorker, outreachWorker, followupWorker];

  workers.forEach(worker => {
    worker.on('completed', (job) => {
      logger.debug(`Job ${job.id} completed on ${worker.name}`);
    });

    worker.on('failed', async (job, err) => {
      logger.error(`Job ${job?.id} failed on ${worker.name}:`, err.message);
      if (job?.data?.campaignId) {
        try {
          const { Campaign } = require('../models');
          await Campaign.update(
            { status: 'failed', error_message: err.message },
            { where: { id: job.data.campaignId } }
          );
        } catch(e) { logger.error('Could not update failed campaign:', e.message); }
      }
    });

    worker.on('error', (err) => {
      logger.error(`Worker ${worker.name} error:`, err.message);
    });
  });

  logger.info(`${workers.length} BullMQ workers started.`);
}

async function shutdownWorkers() {
  for (const worker of workers) {
    await worker.close();
  }
  logger.info('All workers shut down.');
}

module.exports = { initWorkers, shutdownWorkers };
