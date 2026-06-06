const express = require('express');
const { OutreachEmail, Business, Campaign, Followup } = require('../models');
const authenticate = require('../middleware/auth');
const { callGroq } = require('../config/groq');
const { getEmailQueue } = require('../queues');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const { classification, campaign_id } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const where = { status: 'replied' };
    if (classification) where.reply_classification = classification;

    const include = [{
      model: Business,
      as: 'business',
      attributes: ['id', 'name', 'website', 'category'],
      include: [{
        model: Campaign,
        as: 'campaign',
        where: {
          user_id: req.user.id,
          ...(campaign_id ? { id: campaign_id } : {}),
        },
        attributes: ['id', 'query'],
      }],
    }];

    const { count, rows } = await OutreachEmail.findAndCountAll({
      where,
      include,
      order: [['replied_at', 'DESC']],
      limit,
      offset,
      distinct: true,
    });

    res.json({
      success: true,
      data: {
        replies: rows,
        pagination: {
          total: count,
          page,
          limit,
          totalPages: Math.ceil(count / limit),
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/respond', async (req, res, next) => {
  try {
    const { body: responseBody } = req.body;
    if (!responseBody) {
      return res.status(400).json({ success: false, message: 'Response body required.' });
    }

    const outreach = await OutreachEmail.findByPk(req.params.id, {
      include: [{
        model: Business,
        as: 'business',
        include: [{ model: Campaign, as: 'campaign', where: { user_id: req.user.id } }],
      }],
    });

    if (!outreach) {
      return res.status(404).json({ success: false, message: 'Reply not found.' });
    }

    const followup = await Followup.create({
      outreach_id: outreach.id,
      sequence_number: (await Followup.count({ where: { outreach_id: outreach.id } })) + 1,
      subject: `Re: ${outreach.subject}`,
      body: responseBody,
      status: 'approved',
    });

    const emailQueue = getEmailQueue();
    await emailQueue.add('send-followup', {
      followupId: followup.id,
      outreachId: outreach.id,
      userId: req.user.id,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });

    logger.info(`Response queued for outreach ${outreach.id}`);

    res.json({
      success: true,
      message: 'Response queued for sending.',
      data: { followup },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/classify', async (req, res, next) => {
  try {
    const outreach = await OutreachEmail.findByPk(req.params.id, {
      include: [{
        model: Business,
        as: 'business',
        include: [{ model: Campaign, as: 'campaign', where: { user_id: req.user.id } }],
      }],
    });

    if (!outreach) {
      return res.status(404).json({ success: false, message: 'Reply not found.' });
    }

    if (!outreach.reply_text) {
      return res.status(400).json({ success: false, message: 'No reply text to classify.' });
    }

    const classificationPrompt = [
      {
        role: 'system',
        content: `You are an email reply classifier. Classify the reply into exactly one of these categories:
- interested: They want to know more, are curious, or show positive intent
- send_pricing: They asked about pricing, costs, or packages
- call_me: They want a phone call or meeting
- already_have: They already have the solution you're offering
- not_interested: They explicitly declined
- unsubscribe: They want to be removed from the list
- other: Anything that doesn't fit above

Respond with ONLY the category name, nothing else.`,
      },
      {
        role: 'user',
        content: `Original email subject: ${outreach.subject}\n\nReply text:\n${outreach.reply_text}`,
      },
    ];

    const classification = await callGroq(classificationPrompt, { maxTokens: 50, temperature: 0.1 });
    const cleanClassification = classification.trim().toLowerCase().replace(/[^a-z_]/g, '');

    const validClassifications = ['interested', 'send_pricing', 'call_me', 'already_have', 'not_interested', 'unsubscribe', 'other'];
    const finalClassification = validClassifications.includes(cleanClassification) ? cleanClassification : 'other';

    await outreach.update({ reply_classification: finalClassification });

    if (['interested', 'send_pricing', 'call_me'].includes(finalClassification)) {
      const business = outreach.business;
      if (business) {
        await business.update({
          pipeline_stage: finalClassification === 'call_me' ? 'meeting_scheduled' : 'interested',
          pipeline_updated_at: new Date(),
        });
      }
    }

    logger.info(`Reply classified: ${outreach.id} → ${finalClassification}`);

    res.json({
      success: true,
      message: `Reply classified as: ${finalClassification}`,
      data: { classification: finalClassification },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/generate-followup', async (req, res, next) => {
  try {
    const outreach = await OutreachEmail.findByPk(req.params.id, {
      include: [
        {
          model: Business,
          as: 'business',
          include: [{ model: Campaign, as: 'campaign', where: { user_id: req.user.id } }],
        },
        { model: Followup, as: 'followups' },
      ],
    });

    if (!outreach) {
      return res.status(404).json({ success: false, message: 'Outreach email not found.' });
    }

    const sequenceNum = outreach.followups.length + 1;
    if (sequenceNum > (parseInt(process.env.MAX_FOLLOWUPS) || 3)) {
      return res.status(400).json({ success: false, message: 'Maximum follow-ups reached.' });
    }

    const followupPrompt = [
      {
        role: 'system',
        content: `You are a professional business outreach specialist. Generate a follow-up email that is:
- Brief and respectful
- References the original email naturally
- Adds new value or perspective
- No generic templates
- No portfolio links
- Business-focused
- Under 100 words

This is follow-up #${sequenceNum}. Adjust tone accordingly:
- Follow-up 1: Gentle reminder with an additional insight
- Follow-up 2: Brief check-in with a specific question
- Follow-up 3: Final, graceful closing

Return ONLY the email body text, no subject line.`,
      },
      {
        role: 'user',
        content: `Business: ${outreach.business.name}
Category: ${outreach.business.category || 'General'}
Original email subject: ${outreach.subject}
Original email body: ${outreach.body}
${outreach.reply_text ? `Their reply: ${outreach.reply_text}` : 'No reply received yet.'}`,
      },
    ];

    const followupBody = await callGroq(followupPrompt, { temperature: 0.8 });

    const followup = await Followup.create({
      outreach_id: outreach.id,
      sequence_number: sequenceNum,
      subject: `Re: ${outreach.subject}`,
      body: followupBody.trim(),
      status: 'draft',
      scheduled_at: new Date(Date.now() + (sequenceNum === 1 ? 3 : sequenceNum === 2 ? 5 : 7) * 24 * 60 * 60 * 1000),
    });

    res.json({
      success: true,
      message: 'Follow-up generated.',
      data: { followup },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
