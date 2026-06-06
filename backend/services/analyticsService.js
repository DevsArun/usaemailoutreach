const { AnalyticsEvent, Campaign, Business, OutreachEmail, Email } = require('../models');
const { Op } = require('sequelize');
const sequelize = require('../config/database');
const logger = require('../utils/logger');

async function trackEvent(campaignId, eventType, metadata = {}) {
  try {
    await AnalyticsEvent.create({
      campaign_id: campaignId,
      event_type: eventType,
      metadata,
      timestamp: new Date(),
    });
  } catch (error) {
    logger.error(`Failed to track analytics event: ${error.message}`);
  }
}

async function getOverviewStats(userId) {
  const campaigns = await Campaign.findAll({
    where: { user_id: userId },
    attributes: ['id'],
    raw: true,
  });
  const campaignIds = campaigns.map(c => c.id);

  if (campaignIds.length === 0) {
    return {
      totalCampaigns: 0,
      activeCampaigns: 0,
      totalBusinesses: 0,
      totalEmailsSent: 0,
      totalReplied: 0,
      openRate: 0,
      replyRate: 0,
      dealsWon: 0,
    };
  }

  const [stats] = await Promise.all([
    Promise.all([
      Campaign.count({ where: { user_id: userId } }),
      Campaign.count({ where: { user_id: userId, status: 'running' } }),
      Business.count({ where: { campaign_id: { [Op.in]: campaignIds } } }),
      OutreachEmail.count({ where: { campaign_id: { [Op.in]: campaignIds }, status: { [Op.in]: ['sent', 'delivered', 'opened', 'replied'] } } }),
      OutreachEmail.count({ where: { campaign_id: { [Op.in]: campaignIds }, status: 'replied' } }),
      Business.count({ where: { campaign_id: { [Op.in]: campaignIds }, pipeline_stage: 'won' } }),
    ]),
  ]);

  const [totalCampaigns, activeCampaigns, totalBusinesses, totalEmailsSent, totalReplied, dealsWon] = stats;

  return {
    totalCampaigns,
    activeCampaigns,
    totalBusinesses,
    totalEmailsSent,
    totalReplied,
    openRate: totalEmailsSent > 0 ? ((totalReplied / totalEmailsSent) * 100).toFixed(1) : 0,
    replyRate: totalEmailsSent > 0 ? ((totalReplied / totalEmailsSent) * 100).toFixed(1) : 0,
    dealsWon,
  };
}

async function getCampaignTimeline(campaignId) {
  const events = await AnalyticsEvent.findAll({
    where: { campaign_id: campaignId },
    order: [['timestamp', 'ASC']],
    attributes: ['event_type', 'metadata', 'timestamp'],
  });

  return events.map(e => ({
    type: e.event_type,
    metadata: e.metadata,
    timestamp: e.timestamp,
  }));
}

module.exports = {
  trackEvent,
  getOverviewStats,
  getCampaignTimeline,
};
