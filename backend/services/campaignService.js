const axios = require('axios');
const { Campaign, Business, Review, WebsiteAnalysis, Email, OutreachEmail, AnalyticsEvent } = require('../models');
const { analyzeBusinessWithAI, generateOutreachEmail, matchServices } = require('./groqService');
const { verifyEmail } = require('./verificationService');
const { calculateLeadScore, sleep } = require('../utils/helpers');
const logger = require('../utils/logger');

const SCRAPER_URL = process.env.SCRAPER_SERVICE_URL || 'http://localhost:8000';

async function processCampaign(campaignId, userId, options = {}) {
  const { skipDiscovery = false } = options;
  const campaign = await Campaign.findByPk(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  try {
    logger.info(`Starting campaign pipeline: ${campaignId} - "${campaign.query}"${skipDiscovery ? ' (imported)' : ''}`);

    if (campaign.status !== 'running') return;

    let businesses;
    if (skipDiscovery) {
      // Leads were imported (e.g. from a Colab Google Maps scrape). Process the
      // businesses already stored for this campaign instead of scraping Google.
      await updateProgress(campaign, 'crawling_websites');
      businesses = await Business.findAll({ where: { campaign_id: campaignId } });
      await campaign.update({
        progress: { ...campaign.progress, businesses_found: businesses.length },
      });
      logger.info(`Processing ${businesses.length} imported businesses for campaign ${campaignId}`);
    } else {
      await updateProgress(campaign, 'scraping');
      businesses = await discoverBusinesses(campaign);
      logger.info(`Discovered ${businesses.length} businesses for campaign ${campaignId}`);
    }

    for (let i = 0; i < businesses.length; i++) {
      const freshCampaign = await Campaign.findByPk(campaignId);
      if (freshCampaign.status !== 'running') {
        logger.info(`Campaign ${campaignId} is no longer running. Stopping.`);
        return;
      }

      const business = businesses[i];

      try {
        if (campaign.settings.crawl_websites && business.website) {
          await updateProgress(campaign, 'crawling_websites', { current: i + 1, total: businesses.length });
          await crawlWebsite(business);
        }

        if (campaign.settings.find_emails && business.website) {
          await updateProgress(campaign, 'finding_emails', { current: i + 1, total: businesses.length });
          // Discovers emails AND verifies them — only valid emails are stored.
          await discoverEmails(business, campaign);
        }

        await updateProgress(campaign, 'analyzing', { current: i + 1, total: businesses.length });
        await analyzeBusiness(business, campaign);

        if (campaign.settings.generate_outreach) {
          await updateProgress(campaign, 'generating_outreach', { current: i + 1, total: businesses.length });
          await generateOutreach(business, campaign);
        }

        await sleep(1500);
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

    // Analytics logging must never be able to flip a completed campaign to failed.
    try {
      await AnalyticsEvent.create({
        campaign_id: campaignId,
        event_type: 'campaign_completed',
        metadata: { total_businesses: businesses.length },
      });
    } catch (e) {
      logger.warn(`Could not log campaign_completed event: ${e.message}`);
    }

    logger.info(`Campaign ${campaignId} completed successfully with ${businesses.length} businesses.`);
  } catch (error) {
    logger.error(`Campaign ${campaignId} failed:`, error);
    try {
      await campaign.update({
        status: 'failed',
        error_message: error.message,
        progress: { ...campaign.progress, current_stage: 'failed' },
      });
    } catch (e) {
      logger.error(`Could not mark campaign ${campaignId} failed: ${e.message}`);
    }
  }
}

async function discoverBusinesses(campaign) {
  try {
    // Build a location-aware query. Google Maps returns a proper results feed
    // only when a location is present (e.g. "Plumber in New York"); a bare
    // keyword often yields no list. Append the configured location if the
    // user didn't already include one in the query.
    let searchQuery = (campaign.query || '').trim();
    const loc = (campaign.location || (campaign.settings && campaign.settings.location) || '').trim();
    if (loc && loc.toLowerCase() !== 'united states' && !/\s+in\s+/i.test(searchQuery)) {
      searchQuery = `${searchQuery} in ${loc}`;
    }

    const response = await axios.post(`${SCRAPER_URL}/scrape/businesses`, {
      query: searchQuery,
      // Google Maps is the single discovery source; business websites are then
      // crawled for emails. (Other directories are intentionally not used.)
      sources: ['google_maps'],
      max_results: campaign.settings.max_results || 100,
    }, { timeout: 720000 });

    const businessData = response.data.businesses || [];
    const created = [];
    let reviewsStored = 0;

    for (const biz of businessData) {
      if (!biz.name) continue;
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

        // Reviews are collected inline during business scraping.
        if (Array.isArray(biz.reviews) && biz.reviews.length) {
          for (const rev of biz.reviews.slice(0, 20)) {
            try {
              await Review.create({
                business_id: business.id,
                reviewer_name: rev.reviewer_name || 'Anonymous',
                rating: parseInt(rev.rating) || 0,
                text: rev.text || '',
                review_date: rev.date || '',
                source: 'google_maps',
              });
              reviewsStored++;
            } catch (e) { /* skip bad review */ }
          }
        }
        created.push(business);
      }
    }

    if (reviewsStored) logger.info(`Stored ${reviewsStored} reviews inline for campaign ${campaign.id}`);

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

async function discoverEmails(business, campaign) {
  if (!business.website) return;

  try {
    const url = business.website.startsWith('http') ? business.website : `https://${business.website}`;
    const response = await axios.post(`${SCRAPER_URL}/discover/emails`, {
      url,
      max_pages: 5,
    }, { timeout: 120000 });

    const emails = response.data.emails || [];
    let storedValid = 0;

    for (const em of emails) {
      const addr = (em.email || '').toLowerCase().trim();
      if (!addr) continue;

      const existing = await Email.findOne({
        where: { business_id: business.id, email: addr },
      });
      if (existing) continue;

      // VERIFY BEFORE STORING — only deliverable ('valid') emails are persisted.
      // Anything risky / invalid / catch-all is discarded and never written to the DB.
      let verification;
      try {
        verification = await verifyEmail(addr);
      } catch (e) {
        verification = { status: 'risky', details: { error: e.message } };
      }

      if (verification.status !== 'valid') {
        logger.info(`Discarding unverified email ${addr} (${verification.status}) for ${business.name}`);
        continue;
      }

      await Email.create({
        business_id: business.id,
        email: addr,
        type: em.type || 'general',
        source: em.source_page || business.website,
        verification_status: 'valid',
        verification_details: verification.details || {},
        verified_at: new Date(),
      });
      storedValid++;
    }

    if (campaign && storedValid) {
      await campaign.update({
        progress: {
          ...campaign.progress,
          emails_found: (campaign.progress.emails_found || 0) + storedValid,
          emails_verified: (campaign.progress.emails_verified || 0) + storedValid,
        },
      });
    }

    if (storedValid) logger.info(`Stored ${storedValid} verified email(s) for ${business.name}`);
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

  // Only persist genuinely AI-personalized emails. If the AI is unavailable
  // (e.g. no Groq key) generateOutreachEmail returns null and we skip — no
  // generic/templated drafts are ever created.
  if (!emailContent) {
    logger.info(`Skipping outreach for ${business.name} — AI did not produce a personalized email.`);
    return;
  }

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

function normalizeReviews(biz) {
  let reviews = [];
  if (Array.isArray(biz.reviews)) {
    reviews = biz.reviews;
  } else {
    const raw = biz.reviews || biz['Recent Reviews (Last 20)'] || '';
    if (raw && typeof raw === 'string' && !/^no reviews/i.test(raw)) {
      reviews = raw.split('|+|').map(s => ({ text: s.trim() })).filter(r => r.text);
    }
  }
  return reviews.slice(0, 20).map(rev => ({
    reviewer_name: rev.reviewer_name || 'Anonymous',
    rating: parseInt(rev.rating) || 0,
    text: (rev.text || '').toString().slice(0, 5000),
    review_date: rev.date || '',
    source: 'google_maps',
  }));
}

/**
 * Ingest businesses scraped externally (e.g. a Google Colab Google Maps run)
 * into a campaign. Uses bulk inserts (2 queries instead of hundreds) so large
 * imports complete in seconds rather than timing out. Returns count created.
 */
async function importBusinesses(campaignId, businessesData) {
  const seen = new Set();
  const prepared = []; // { row, reviews, key }

  for (const biz of (businessesData || [])) {
    const name = (biz.name || biz['Business Name'] || '').toString().trim();
    if (!name) continue;
    const address = (biz.address || biz['Address'] || '').toString().trim();
    const key = `${name.toLowerCase()}|${address.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    prepared.push({
      key,
      reviews: normalizeReviews(biz),
      row: {
        campaign_id: campaignId,
        name,
        address,
        phone: (biz.phone || biz['Phone'] || '').toString().trim(),
        website: (biz.website || biz['Website'] || '').toString().replace(/^No Website.*/i, '').trim(),
        rating: parseFloat(biz.rating ?? biz['Rating']) || null,
        reviews_count: parseInt(biz.reviews_count ?? biz['Total Reviews']) || 0,
        category: (biz.category || biz['Business Type'] || '').toString().trim(),
        source: 'google_maps_import',
      },
    });
  }

  if (prepared.length === 0) return 0;

  // Skip businesses already present in this campaign (single query).
  const existing = await Business.findAll({
    where: { campaign_id: campaignId },
    attributes: ['name', 'address'],
    raw: true,
  });
  const existSet = new Set(existing.map(e => `${(e.name || '').toLowerCase()}|${(e.address || '').toLowerCase()}`));
  const toCreate = prepared.filter(p => !existSet.has(p.key));
  if (toCreate.length === 0) return 0;

  // Bulk insert businesses, then bulk insert all their reviews.
  const createdBusinesses = await Business.bulkCreate(toCreate.map(p => p.row), { returning: true });

  const idByKey = {};
  createdBusinesses.forEach(b => {
    idByKey[`${(b.name || '').toLowerCase()}|${(b.address || '').toLowerCase()}`] = b.id;
  });

  const reviewRows = [];
  for (const p of toCreate) {
    const bid = idByKey[p.key];
    if (!bid) continue;
    for (const rev of p.reviews) reviewRows.push({ business_id: bid, ...rev });
  }
  if (reviewRows.length) {
    await Review.bulkCreate(reviewRows);
  }

  logger.info(`Imported ${createdBusinesses.length} businesses (${reviewRows.length} reviews) into campaign ${campaignId}`);
  return createdBusinesses.length;
}

module.exports = {
  processCampaign,
  importBusinesses,
};
