const express = require('express');
const { Campaign, Business, OutreachEmail, AnalyticsEvent } = require('../models');
const authenticate = require('../middleware/auth');
const { campaignValidation, paginationValidation } = require('../utils/validators');
const { parseSearchQuery, buildPaginationMeta } = require('../utils/helpers');
const { enqueue } = require('../queues');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authenticate);

router.get('/', paginationValidation, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const status = req.query.status;

    const where = { user_id: req.user.id };
    if (status) where.status = status;

    const { count, rows } = await Campaign.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });

    res.json({
      success: true,
      data: {
        campaigns: rows,
        pagination: buildPaginationMeta(count, page, limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const campaign = await Campaign.findOne({
      where: { id: req.params.id, user_id: req.user.id },
      include: [
        {
          model: Business,
          as: 'businesses',
          attributes: ['id', 'name', 'lead_score', 'pipeline_stage'],
          limit: 10,
          order: [['lead_score', 'DESC']],
        },
      ],
    });

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found.' });
    }

    const stats = await Business.findAll({
      where: { campaign_id: campaign.id },
      attributes: [
        [Business.sequelize.fn('COUNT', Business.sequelize.col('id')), 'total_businesses'],
        [Business.sequelize.fn('AVG', Business.sequelize.col('lead_score')), 'avg_lead_score'],
      ],
      raw: true,
    });

    const emailStats = await OutreachEmail.findAll({
      where: { campaign_id: campaign.id },
      attributes: [
        'status',
        [OutreachEmail.sequelize.fn('COUNT', OutreachEmail.sequelize.col('id')), 'count'],
      ],
      group: ['status'],
      raw: true,
    });

    res.json({
      success: true,
      data: {
        campaign,
        stats: stats[0] || {},
        emailStats,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/', campaignValidation, async (req, res, next) => {
  try {
    const { query, settings } = req.body;
    const { keyword, location } = parseSearchQuery(query);

    const campaign = await Campaign.create({
      user_id: req.user.id,
      query,
      keyword,
      location,
      settings: {
        sources: ['google_maps'],
        max_results: 100,
        scrape_reviews: true,
        crawl_websites: true,
        find_emails: true,
        verify_emails: true,
        generate_outreach: true,
        daily_email_limit: parseInt(process.env.DEFAULT_DAILY_EMAIL_LIMIT) || 50,
        ...settings,
      },
    });

    await AnalyticsEvent.create({
      campaign_id: campaign.id,
      event_type: 'campaign_created',
      metadata: { query, keyword, location },
    });

    logger.info(`Campaign created: ${campaign.id} - "${query}"`);

    res.status(201).json({
      success: true,
      message: 'Campaign created successfully.',
      data: { campaign },
    });
  } catch (error) {
    next(error);
  }
});

router.put('/:id/start', async (req, res, next) => {
  try {
    const campaign = await Campaign.findOne({
      where: { id: req.params.id, user_id: req.user.id },
    });

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found.' });
    }

    if (campaign.status === 'running') {
      return res.status(400).json({ success: false, message: 'Campaign is already running.' });
    }

    await campaign.update({
      status: 'running',
      started_at: new Date(),
      error_message: null,
      progress: {
        ...campaign.progress,
        current_stage: 'scraping',
      },
    });

    await enqueue('campaign-queue', 'process-campaign', {
      campaignId: campaign.id,
      userId: req.user.id,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: { count: 100 },
    });

    await AnalyticsEvent.create({
      campaign_id: campaign.id,
      event_type: 'campaign_started',
    });

    logger.info(`Campaign started: ${campaign.id}`);

    res.json({
      success: true,
      message: 'Campaign started.',
      data: { campaign },
    });
  } catch (error) {
    next(error);
  }
});

router.put('/:id/pause', async (req, res, next) => {
  try {
    const campaign = await Campaign.findOne({
      where: { id: req.params.id, user_id: req.user.id },
    });

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found.' });
    }

    if (campaign.status !== 'running') {
      return res.status(400).json({ success: false, message: 'Campaign is not running.' });
    }

    await campaign.update({
      status: 'paused',
      progress: { ...campaign.progress, current_stage: 'paused' },
    });

    await AnalyticsEvent.create({
      campaign_id: campaign.id,
      event_type: 'campaign_paused',
    });

    logger.info(`Campaign paused: ${campaign.id}`);

    res.json({
      success: true,
      message: 'Campaign paused.',
      data: { campaign },
    });
  } catch (error) {
    next(error);
  }
});

router.put('/:id/stop', async (req, res, next) => {
  try {
    const campaign = await Campaign.findOne({
      where: { id: req.params.id, user_id: req.user.id },
    });

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found.' });
    }

    await campaign.update({
      status: 'stopped',
      completed_at: new Date(),
      progress: { ...campaign.progress, current_stage: 'stopped' },
    });

    await AnalyticsEvent.create({
      campaign_id: campaign.id,
      event_type: 'campaign_stopped',
    });

    logger.info(`Campaign stopped: ${campaign.id}`);

    res.json({
      success: true,
      message: 'Campaign stopped.',
      data: { campaign },
    });
  } catch (error) {
    next(error);
  }
});

router.put('/:id/reset', async (req, res, next) => {
  try {
    const campaign = await Campaign.findOne({
      where: { id: req.params.id, user_id: req.user.id },
    });

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found.' });
    }

    if (!['running', 'failed'].includes(campaign.status)) {
      return res.status(400).json({ success: false, message: 'Only running or failed campaigns can be reset.' });
    }

    await campaign.update({
      status: 'pending',
      error_message: null,
    });

    logger.info(`Campaign reset: ${campaign.id}`);

    res.json({
      success: true,
      message: 'Campaign reset to pending.',
      data: { campaign },
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const campaign = await Campaign.findOne({
      where: { id: req.params.id, user_id: req.user.id },
    });

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found.' });
    }

    if (campaign.status === 'running') {
      return res.status(400).json({ success: false, message: 'Stop the campaign before deleting.' });
    }

    await campaign.destroy();
    logger.info(`Campaign deleted: ${campaign.id}`);

    res.json({
      success: true,
      message: 'Campaign deleted.',
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
