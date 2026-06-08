const express = require('express');
const { Business, Review, WebsiteAnalysis, Email, OutreachEmail, Followup, Campaign } = require('../models');
const authenticate = require('../middleware/auth');
const { paginationValidation } = require('../utils/validators');
const { buildPaginationMeta } = require('../utils/helpers');
const { reverifyAndGenerate } = require('../services/reverifyService');
const logger = require('../utils/logger');
const { Op } = require('sequelize');

const router = express.Router();
router.use(authenticate);

router.get('/', paginationValidation, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const { campaign_id, min_score, max_score, stage, search, sort_by, sort_order } = req.query;

    const where = {};
    const campaignWhere = { user_id: req.user.id };

    if (campaign_id) where.campaign_id = campaign_id;
    if (min_score) where.lead_score = { ...where.lead_score, [Op.gte]: parseInt(min_score) };
    if (max_score) where.lead_score = { ...where.lead_score, [Op.lte]: parseInt(max_score) };
    if (stage) where.pipeline_stage = stage;
    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { address: { [Op.iLike]: `%${search}%` } },
        { category: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const order = [];
    if (sort_by) {
      order.push([sort_by, sort_order === 'asc' ? 'ASC' : 'DESC']);
    } else {
      order.push(['lead_score', 'DESC']);
    }

    const { count, rows } = await Business.findAndCountAll({
      where,
      include: [
        {
          model: Campaign,
          as: 'campaign',
          where: campaignWhere,
          attributes: ['id', 'query'],
        },
        {
          model: Email,
          as: 'emails',
          where: { verification_status: 'valid' },
          required: false,
          attributes: ['id', 'email', 'type', 'verification_status'],
        },
      ],
      order,
      limit,
      offset,
      distinct: true,
    });

    res.json({
      success: true,
      data: {
        businesses: rows,
        pagination: buildPaginationMeta(count, page, limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const business = await Business.findByPk(req.params.id, {
      include: [
        {
          model: Campaign,
          as: 'campaign',
          where: { user_id: req.user.id },
          attributes: ['id', 'query'],
        },
        {
          model: Review,
          as: 'reviews',
          order: [['review_date', 'DESC']],
          limit: 20,
        },
        {
          model: WebsiteAnalysis,
          as: 'website_analysis',
        },
        {
          model: Email,
          as: 'emails',
        },
        {
          model: OutreachEmail,
          as: 'outreach_emails',
          order: [['created_at', 'DESC']],
          limit: 10,
        },
      ],
    });

    if (!business) {
      return res.status(404).json({ success: false, message: 'Business not found.' });
    }

    res.json({
      success: true,
      data: { business },
    });
  } catch (error) {
    next(error);
  }
});

router.put('/:id/stage', async (req, res, next) => {
  try {
    const { stage, notes } = req.body;

    const business = await Business.findByPk(req.params.id, {
      include: [{
        model: Campaign,
        as: 'campaign',
        where: { user_id: req.user.id },
      }],
    });

    if (!business) {
      return res.status(404).json({ success: false, message: 'Business not found.' });
    }

    await business.update({
      pipeline_stage: stage,
      pipeline_notes: notes || business.pipeline_notes,
      pipeline_updated_at: new Date(),
    });

    res.json({
      success: true,
      message: 'Pipeline stage updated.',
      data: { business },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/reviews', async (req, res, next) => {
  try {
    const business = await Business.findByPk(req.params.id, {
      include: [{
        model: Campaign,
        as: 'campaign',
        where: { user_id: req.user.id },
      }],
    });

    if (!business) {
      return res.status(404).json({ success: false, message: 'Business not found.' });
    }

    const reviews = await Review.findAll({
      where: { business_id: business.id },
      order: [['review_date', 'DESC']],
    });

    res.json({
      success: true,
      data: { reviews },
    });
  } catch (error) {
    next(error);
  }
});

// Re-verify pending emails, re-crawl websites of businesses that still have no
// valid email, then auto-generate AI outreach for any valid lead without a
// draft. Runs in the background so the request returns immediately.
router.post('/verify-emails', async (req, res, next) => {
  try {
    const { campaign_id } = req.body || {};

    setImmediate(() => {
      reverifyAndGenerate(req.user.id, campaign_id)
        .catch(err => logger.error('verify-emails background error:', err.message));
    });

    res.json({
      success: true,
      message: 'Working in the background: re-verifying emails, searching business websites for missing emails, and generating AI outreach for valid leads. Refresh Leads & Outreach in 1-2 minutes.',
    });
  } catch (error) {
    next(error);
  }
});

// Cascade-delete a set of businesses and all their child records.
async function deleteBusinessesCascade(businessIds) {
  if (!businessIds.length) return;
  const outreach = await OutreachEmail.findAll({
    where: { business_id: businessIds }, attributes: ['id'], raw: true,
  });
  const outreachIds = outreach.map(o => o.id);
  if (outreachIds.length) await Followup.destroy({ where: { outreach_id: outreachIds } });
  await OutreachEmail.destroy({ where: { business_id: businessIds } });
  await Email.destroy({ where: { business_id: businessIds } });
  await Review.destroy({ where: { business_id: businessIds } });
  await WebsiteAnalysis.destroy({ where: { business_id: businessIds } });
  await Business.destroy({ where: { id: businessIds } });
}

// Bulk delete leads (only those whose campaign belongs to the current user).
router.post('/bulk-delete', async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Provide a non-empty "ids" array.' });
    }

    const owned = await Business.findAll({
      where: { id: ids },
      include: [{ model: Campaign, as: 'campaign', where: { user_id: req.user.id }, attributes: [] }],
      attributes: ['id'],
      raw: true,
    });
    const ownedIds = owned.map(b => b.id);
    if (ownedIds.length === 0) {
      return res.status(404).json({ success: false, message: 'No matching leads found.' });
    }

    await deleteBusinessesCascade(ownedIds);
    res.json({ success: true, message: `${ownedIds.length} lead(s) deleted.`, data: { deleted: ownedIds.length } });
  } catch (error) {
    next(error);
  }
});

// Delete a single lead.
router.delete('/:id', async (req, res, next) => {
  try {
    const business = await Business.findByPk(req.params.id, {
      include: [{ model: Campaign, as: 'campaign', where: { user_id: req.user.id }, attributes: ['id'] }],
    });
    if (!business) {
      return res.status(404).json({ success: false, message: 'Lead not found.' });
    }

    await deleteBusinessesCascade([business.id]);
    res.json({ success: true, message: 'Lead deleted.' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
