const axios = require('axios');
const { Campaign, Business, Review, WebsiteAnalysis, Email, OutreachEmail, AnalyticsEvent } = require('../models');
const { analyzeBusinessWithAI, generateOutreachEmail, matchServices } = require('./groqService');
const { verifyEmail } = require('./verificationService');
const { calculateLeadScore, sleep } = require('../utils/helpers');
const logger = require('../utils/logger');

const SCRAPER_URL = process.env.SCRAPER_SERVICE_URL || 'http://localhost:8000';

async function processCampaign(campaignId, userId) {
  const campaign = await Campaign.findByPk(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  try {
    logger.info(`Starting campaign pipeline: ${campaignId} - "${campaign.query}"`);

    if (campaign.status !== 'running') return;
    await updateProgress(campaign, 'scraping');
    const businesses = await discoverBusinesses(campaign);
    logger.info(`Discovered ${businesses.length} businesses for campaign ${campaignId}`);

    for (let i = 0; i < businesses.length; i++) {
      const freshCampaign = await Campaign.findByPk(campaignId);
      if (freshCampaign.status !== 'running') {
        logger.info(`Campaign ${campaignId} is no longer running. Stopping.`);
        return;
      }

      const business = businesses[i];

      try {
        if (campaign.settings.scrape_reviews) {
          await updateProgress(campaign, 'collecting_reviews', { current: i + 1, total: businesses.length });
          await collectReviews(business);
        }

        if (campaign.settings.crawl_websites && business.website) {
          await updateProgress(campaign, 'crawling_websites', { current: i + 1, total: businesses.length });
          await crawlWebsite(business);
        }

        if (campaign.settings.find_emails && business.website) {
          await updateProgress(campaign, 'finding_emails', { current: i + 1, total: businesses.length });
          await discoverEmails(business);
        }

        await updateProgress(campaign, 'analyzing', { current: i + 1, total: businesses.length });
        await analyzeBusiness(business, campaign);

        if (campaign.settings.verify_emails) {
          await updateProgress(campaign, 'verifying_emails', { current: i + 1, total: businesses.length });
          await verifyBusinessEmails(business);
        }

        if (campaign.settings.generate_outreach) {
          await updateProgress(campaign, 'generating_outreach', { current: i + 1, total: businesses.length });
          await generateOutreach(business, campaign);
        }

        await sleep(2000);
      } catch (err) {
        logger.error(`Error processing business ${business.id} (${business.name}):`, err);
        continue;
      }
    }

    await campaign.update({
      status: 'completed',
      completed_at: new Date(),
      progress: { ...campaign.progress, current_stage: 'completed' },
    });

    await AnalyticsEvent.create({
      campaign_id: campaignId,
      event_type: 'campaign_completed',
      metadata: { total_businesses: businesses.length },
    });

    logger.info(`Campaign ${campaignId} completed successfully.`);
  } catch (error) {
    logger.error(`Campaign ${campaignId} failed:`, error);
    await campaign.update({
      status: 'failed',
      error_message: error.message,
      progress: { ...campaign.progress, current_stage: 'failed' },
    });
  }
}

async function discoverBusinesses(campaign) {
  try {
    const response = await axios.post(`${SCRAPER_URL}/scrape/businesses`, {
      query: campaign.query,
      sources: campaign.settings.sources || ['google_maps'],
      max_results: campaign.settings.max_results || 100,
    }, { timeout: 300000 });

    const businessData = response.data.businesses || [];
    const created = [];

    for (const biz of businessData) {
      const existing = await Business.findOne({
        where: {
          campaign_id: campaign.id,
          name: biz.name,
          address: biz.address || '',
        },
      });

      if (!existing) {
        const business = await Business.create({
          campaign_id: campaign.id,
          name: biz.name,
          address: biz.address || '',
          phone: biz.phone || '',
          website: biz.website || '',
          rating: biz.rating || null,
          reviews_count: biz.reviews_count || 0,
          category: biz.category || '',
          opening_hours: biz.opening_hours || {},
          owner_name: biz.owner_name || null,
          social_links: biz.social_links || {},
          source: biz.source || 'google_maps',
          latitude: biz.latitude || null,
          longitude: biz.longitude || null,
        });
        created.push(business);
      }
    }

    await campaign.update({
      progress: {
        ...campaign.progress,
        businesses_found: created.length,
      },
    });

    return created;
  } catch (error) {
    logger.error(`Business discovery failed: ${error.message}`);
    return [];
  }
}

async function collectReviews(business) {
  try {
    const response = await axios.post(`${SCRAPER_URL}/scrape/reviews`, {
      business_name: business.name,
      location: business.address,
      source: 'google_maps',
      max_reviews: 20,
    }, { timeout: 120000 });

    const reviews = response.data.reviews || [];
    for (const rev of reviews) {
      await Review.create({
        business_id: business.id,
        reviewer_name: rev.reviewer_name || 'Anonymous',
        rating: rev.rating || 0,
        text: rev.text || '',
        review_date: rev.date || '',
        source: rev.source || 'google_maps',
      });
    }
  } catch (error) {
    logger.error(`Review collection failed for ${business.name}: ${error.message}`);
  }
}

async function crawlWebsite(business) {
  if (!business.website) return;

  try {
    const url = business.website.startsWith('http') ? business.website : `https://${business.website}`;
    const response = await axios.post(`${SCRAPER_URL}/crawl/website`, {
      url,
      max_pages: 10,
    }, { timeout: 180000 });

    const data = response.data;
    await WebsiteAnalysis.upsert({
      business_id: business.id,
      url,
      title: data.title || '',
      meta_description: data.meta_description || '',
      services: data.services || [],
      contact_info: data.contact_info || {},
      pages_crawled: data.pages_crawled || 0,
      mobile_friendly: data.technical?.mobile_friendly ?? null,
      ssl: data.technical?.ssl ?? null,
      page_speed: data.technical?.page_speed_score ?? null,
      broken_links: data.technical?.broken_links || [],
      has_chatbot: data.features?.has_chatbot || false,
      has_whatsapp: data.features?.has_whatsapp || false,
      has_crm: data.features?.has_crm || false,
      has_booking: data.features?.has_booking || false,
      has_reviews_widget: data.features?.has_reviews_widget || false,
      has_automation: data.features?.has_automation || false,
      has_lead_capture: data.features?.has_lead_capture || false,
      has_live_chat: data.features?.has_live_chat || false,
      tech_stack: data.tech_stack || [],
      forms: data.forms || [],
      raw_data: data,
    });
  } catch (error) {
    logger.error(`Website crawl failed for ${business.name}: ${error.message}`);
  }
}

async function discoverEmails(business) {
  if (!business.website) return;

  try {
    const url = business.website.startsWith('http') ? business.website : `https://${business.website}`;
    const response = await axios.post(`${SCRAPER_URL}/discover/emails`, {
      url,
      max_pages: 5,
    }, { timeout: 120000 });

    const emails = response.data.emails || [];
    for (const em of emails) {
      const existing = await Email.findOne({
        where: { business_id: business.id, email: em.email.toLowerCase() },
      });

      if (!existing) {
        await Email.create({
          business_id: business.id,
          email: em.email.toLowerCase(),
          type: em.type || 'general',
          source: em.source_page || business.website,
        });
      }
    }
  } catch (error) {
    logger.error(`Email discovery failed for ${business.name}: ${error.message}`);
  }
}

async function analyzeBusiness(business, campaign) {
  const reviews = await Review.findAll({
    where: { business_id: business.id },
    limit: 20,
    order: [['created_at', 'DESC']],
  });

  const websiteAnalysis = await WebsiteAnalysis.findOne({
    where: { business_id: business.id },
  });

  const aiAnalysis = await analyzeBusinessWithAI(business, reviews, websiteAnalysis);
  const services = await matchServices(websiteAnalysis, aiAnalysis.pain_points);

  const leadScore = aiAnalysis.business_score || calculateLeadScore(business, websiteAnalysis, {
    negative_sentiment_ratio: reviews.filter(r => r.rating <= 2).length / Math.max(reviews.length, 1),
  });

  await business.update({
    lead_score: leadScore,
    ai_analysis: aiAnalysis,
    recommended_services: services,
    pain_points: aiAnalysis.pain_points || [],
    pipeline_stage: 'analyzed',
    pipeline_updated_at: new Date(),
  });

  await campaign.update({
    progress: {
      ...campaign.progress,
      reviews_collected: (campaign.progress.reviews_collected || 0) + reviews.length,
      websites_crawled: (campaign.progress.websites_crawled || 0) + (websiteAnalysis ? 1 : 0),
    },
  });
}

async function verifyBusinessEmails(business) {
  const emails = await Email.findAll({
    where: { business_id: business.id, verification_status: 'pending' },
  });

  for (const emailRecord of emails) {
    const result = await verifyEmail(emailRecord.email);
    await emailRecord.update({
      verification_status: result.status,
      verification_details: result.details,
      verified_at: new Date(),
    });
    await sleep(1000);
  }
}

async function generateOutreach(business, campaign) {
  const validEmails = await Email.findAll({
    where: { business_id: business.id, verification_status: 'valid' },
  });

  if (validEmails.length === 0) return;

  const bestEmail = validEmails.find(e => e.type === 'owner')
    || validEmails.find(e => e.type === 'general')
    || validEmails.find(e => e.type === 'marketing')
    || validEmails[0];

  const reviews = await Review.findAll({
    where: { business_id: business.id },
    limit: 10,
  });

  const websiteAnalysis = await WebsiteAnalysis.findOne({
    where: { business_id: business.id },
  });

  const emailContent = await generateOutreachEmail(
    business,
    reviews,
    websiteAnalysis,
    business.ai_analysis || {}
  );

  await OutreachEmail.create({
    business_id: business.id,
    campaign_id: campaign.id,
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

  await campaign.update({
    progress: {
      ...campaign.progress,
      emails_found: (campaign.progress.emails_found || 0) + validEmails.length,
      emails_verified: (campaign.progress.emails_verified || 0) + validEmails.length,
      outreach_generated: (campaign.progress.outreach_generated || 0) + 1,
    },
  });
}

async function updateProgress(campaign, stage, extra = {}) {
  await campaign.update({
    progress: {
      ...campaign.progress,
      current_stage: stage,
      ...extra,
    },
  });
}

module.exports = {
  processCampaign,
};
