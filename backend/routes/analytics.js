const express = require('express');
const { AnalyticsEvent, Campaign, Business, OutreachEmail, Email } = require('../models');
const authenticate = require('../middleware/auth');
const { Op } = require('sequelize');
const sequelize = require('../config/database');

const router = express.Router();
router.use(authenticate);

router.get('/overview', async (req, res, next) => {
  try {
    const campaigns = await Campaign.findAll({
      where: { user_id: req.user.id },
      attributes: ['id'],
      raw: true,
    });
    const campaignIds = campaigns.map(c => c.id);

    if (campaignIds.length === 0) {
      return res.json({
        success: true,
        data: {
          totalCampaigns: 0,
          totalBusinesses: 0,
          totalEmailsFound: 0,
          totalEmailsVerified: 0,
          totalEmailsSent: 0,
          totalOpened: 0,
          totalReplied: 0,
          openRate: 0,
          replyRate: 0,
          meetingsBooked: 0,
          dealsWon: 0,
          revenuePotential: 'N/A',
          activeCampaigns: 0,
        },
      });
    }

    const [
      totalBusinesses,
      totalEmailsFound,
      totalEmailsVerified,
      totalEmailsSent,
      totalOpened,
      totalReplied,
      meetingsBooked,
      dealsWon,
      activeCampaigns,
    ] = await Promise.all([
      Business.count({ where: { campaign_id: { [Op.in]: campaignIds } } }),
      Email.count({
        include: [{ model: Business, as: 'business', where: { campaign_id: { [Op.in]: campaignIds } }, attributes: [] }],
      }),
      Email.count({
        where: { verification_status: 'valid' },
        include: [{ model: Business, as: 'business', where: { campaign_id: { [Op.in]: campaignIds } }, attributes: [] }],
      }),
      OutreachEmail.count({ where: { campaign_id: { [Op.in]: campaignIds }, status: { [Op.in]: ['sent', 'delivered', 'opened', 'replied'] } } }),
      OutreachEmail.count({ where: { campaign_id: { [Op.in]: campaignIds }, status: { [Op.in]: ['opened', 'replied'] } } }),
      OutreachEmail.count({ where: { campaign_id: { [Op.in]: campaignIds }, status: 'replied' } }),
      Business.count({ where: { campaign_id: { [Op.in]: campaignIds }, pipeline_stage: 'meeting_scheduled' } }),
      Business.count({ where: { campaign_id: { [Op.in]: campaignIds }, pipeline_stage: 'won' } }),
      Campaign.count({ where: { user_id: req.user.id, status: 'running' } }),
    ]);

    const openRate = totalEmailsSent > 0 ? ((totalOpened / totalEmailsSent) * 100).toFixed(1) : 0;
    const replyRate = totalEmailsSent > 0 ? ((totalReplied / totalEmailsSent) * 100).toFixed(1) : 0;

    res.json({
      success: true,
      data: {
        totalCampaigns: campaignIds.length,
        totalBusinesses,
        totalEmailsFound,
        totalEmailsVerified,
        totalEmailsSent,
        totalOpened,
        totalReplied,
        openRate: parseFloat(openRate),
        replyRate: parseFloat(replyRate),
        meetingsBooked,
        dealsWon,
        activeCampaigns,
        revenuePotential: dealsWon > 0 ? `$${(dealsWon * 2500).toLocaleString()}+` : 'Calculating...',
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const { campaign_id, date_from, date_to } = req.query;

    const campaignWhere = { user_id: req.user.id };
    if (campaign_id) campaignWhere.id = campaign_id;

    const campaigns = await Campaign.findAll({
      where: campaignWhere,
      attributes: ['id'],
      raw: true,
    });
    const campaignIds = campaigns.map(c => c.id);

    if (campaignIds.length === 0) {
      return res.json({
        success: true,
        data: {
          emailsOverTime: [],
          openRateByDay: [],
          leadSourceDistribution: [],
          pipelineFunnel: [],
          topPerformingCampaigns: [],
        },
      });
    }

    const dateWhere = {};
    if (date_from) dateWhere[Op.gte] = new Date(date_from);
    if (date_to) dateWhere[Op.lte] = new Date(date_to);

    const emailsOverTime = await OutreachEmail.findAll({
      where: {
        campaign_id: { [Op.in]: campaignIds },
        sent_at: { [Op.ne]: null, ...dateWhere },
      },
      attributes: [
        [sequelize.fn('DATE', sequelize.col('sent_at')), 'date'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      ],
      group: [sequelize.fn('DATE', sequelize.col('sent_at'))],
      order: [[sequelize.fn('DATE', sequelize.col('sent_at')), 'ASC']],
      raw: true,
    });

    const leadSourceDistribution = await Business.findAll({
      where: { campaign_id: { [Op.in]: campaignIds } },
      attributes: [
        'source',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      ],
      group: ['source'],
      raw: true,
    });

    const pipelineFunnel = await Business.findAll({
      where: { campaign_id: { [Op.in]: campaignIds } },
      attributes: [
        'pipeline_stage',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      ],
      group: ['pipeline_stage'],
      raw: true,
    });

    const topCampaigns = await Campaign.findAll({
      where: { id: { [Op.in]: campaignIds } },
      attributes: [
        'id', 'query', 'status',
        [sequelize.literal('(SELECT COUNT(*) FROM businesses WHERE businesses.campaign_id = campaigns.id)'), 'business_count'],
        [sequelize.literal('(SELECT COUNT(*) FROM outreach_emails WHERE outreach_emails.campaign_id = campaigns.id AND outreach_emails.status = \'replied\')'), 'reply_count'],
      ],
      order: [[sequelize.literal('reply_count'), 'DESC']],
      limit: 10,
    });

    res.json({
      success: true,
      data: {
        emailsOverTime,
        leadSourceDistribution,
        pipelineFunnel,
        topPerformingCampaigns: topCampaigns,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/insights', async (req, res, next) => {
  try {
    const campaigns = await Campaign.findAll({
      where: { user_id: req.user.id },
      attributes: ['id', 'query', 'keyword', 'location'],
      raw: true,
    });
    const campaignIds = campaigns.map(c => c.id);

    if (campaignIds.length === 0) {
      return res.json({
        success: true,
        data: { insights: { bestNiches: [], bestCities: [], bestServices: [] } },
      });
    }

    const nichePerformance = await Business.findAll({
      where: { campaign_id: { [Op.in]: campaignIds } },
      attributes: [
        'category',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
        [sequelize.fn('AVG', sequelize.col('lead_score')), 'avg_score'],
      ],
      group: ['category'],
      order: [[sequelize.fn('AVG', sequelize.col('lead_score')), 'DESC']],
      limit: 10,
      raw: true,
    });

    res.json({
      success: true,
      data: {
        insights: {
          bestNiches: nichePerformance.map(n => ({
            category: n.category || 'Unknown',
            count: parseInt(n.count),
            avgScore: Math.round(parseFloat(n.avg_score) || 0),
          })),
          bestCities: campaigns.reduce((acc, c) => {
            if (c.location && !acc.includes(c.location)) acc.push(c.location);
            return acc;
          }, []),
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
