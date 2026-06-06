const express = require('express');
const { Email, Business, Campaign } = require('../models');
const authenticate = require('../middleware/auth');
const { paginationValidation } = require('../utils/validators');
const { buildPaginationMeta } = require('../utils/helpers');
const { getVerifyQueue } = require('../queues');

const router = express.Router();
router.use(authenticate);

router.get('/', paginationValidation, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const { campaign_id, status, type } = req.query;

    const where = {};
    const businessWhere = {};

    if (status) where.verification_status = status;
    if (type) where.type = type;

    const include = [{
      model: Business,
      as: 'business',
      attributes: ['id', 'name', 'campaign_id'],
      include: [{
        model: Campaign,
        as: 'campaign',
        where: { user_id: req.user.id, ...(campaign_id ? { id: campaign_id } : {}) },
        attributes: ['id', 'query'],
      }],
    }];

    const { count, rows } = await Email.findAndCountAll({
      where,
      include,
      order: [['created_at', 'DESC']],
      limit,
      offset,
      distinct: true,
    });

    res.json({
      success: true,
      data: {
        emails: rows,
        pagination: buildPaginationMeta(count, page, limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/verify', async (req, res, next) => {
  try {
    const email = await Email.findByPk(req.params.id, {
      include: [{
        model: Business,
        as: 'business',
        include: [{
          model: Campaign,
          as: 'campaign',
          where: { user_id: req.user.id },
        }],
      }],
    });

    if (!email) {
      return res.status(404).json({ success: false, message: 'Email not found.' });
    }

    const verifyQueue = getVerifyQueue();
    await verifyQueue.add('verify-email', {
      emailId: email.id,
      emailAddress: email.email,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });

    res.json({
      success: true,
      message: 'Email verification queued.',
    });
  } catch (error) {
    next(error);
  }
});

router.post('/verify-bulk', async (req, res, next) => {
  try {
    const { email_ids } = req.body;
    if (!email_ids || !Array.isArray(email_ids) || email_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Provide email_ids array.' });
    }

    const verifyQueue = getVerifyQueue();
    let queued = 0;

    for (const emailId of email_ids) {
      const email = await Email.findByPk(emailId, {
        include: [{
          model: Business,
          as: 'business',
          include: [{
            model: Campaign,
            as: 'campaign',
            where: { user_id: req.user.id },
          }],
        }],
      });

      if (email) {
        await verifyQueue.add('verify-email', {
          emailId: email.id,
          emailAddress: email.email,
        }, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        });
        queued++;
      }
    }

    res.json({
      success: true,
      message: `${queued} email(s) queued for verification.`,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
