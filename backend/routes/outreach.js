const express = require('express');
const { OutreachEmail, Business, Campaign, Email, Followup } = require('../models');
const authenticate = require('../middleware/auth');
const { outreachEditValidation, paginationValidation } = require('../utils/validators');
const { buildPaginationMeta } = require('../utils/helpers');
const { getEmailQueue } = require('../queues');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authenticate);

router.get('/', paginationValidation, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const { campaign_id, status } = req.query;

    const where = {};
    if (campaign_id) where.campaign_id = campaign_id;
    if (status) where.status = status;

    const { count, rows } = await OutreachEmail.findAndCountAll({
      where,
      include: [
        {
          model: Business,
          as: 'business',
          attributes: ['id', 'name', 'website', 'lead_score', 'category'],
          include: [{
            model: Campaign,
            as: 'campaign',
            where: { user_id: req.user.id },
            attributes: ['id', 'query'],
          }],
        },
        {
          model: Followup,
          as: 'followups',
          attributes: ['id', 'sequence_number', 'status', 'sent_at'],
        },
      ],
      order: [['created_at', 'DESC']],
      limit,
      offset,
      distinct: true,
    });

    res.json({
      success: true,
      data: {
        outreach: rows,
        pagination: buildPaginationMeta(count, page, limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const outreach = await OutreachEmail.findByPk(req.params.id, {
      include: [
        {
          model: Business,
          as: 'business',
          include: [
            { model: Campaign, as: 'campaign', where: { user_id: req.user.id } },
          ],
        },
        { model: Followup, as: 'followups', order: [['sequence_number', 'ASC']] },
        { model: Email, as: 'email' },
      ],
    });

    if (!outreach) {
      return res.status(404).json({ success: false, message: 'Outreach email not found.' });
    }

    res.json({
      success: true,
      data: { outreach },
    });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', outreachEditValidation, async (req, res, next) => {
  try {
    const outreach = await OutreachEmail.findByPk(req.params.id, {
      include: [{
        model: Business,
        as: 'business',
        include: [{ model: Campaign, as: 'campaign', where: { user_id: req.user.id } }],
      }],
    });

    if (!outreach) {
      return res.status(404).json({ success: false, message: 'Outreach email not found.' });
    }

    if (!['draft', 'rejected'].includes(outreach.status)) {
      return res.status(400).json({ success: false, message: 'Can only edit draft or rejected emails.' });
    }

    const { subject, body } = req.body;
    await outreach.update({
      subject: subject || outreach.subject,
      body: body || outreach.body,
      status: 'draft',
    });

    res.json({
      success: true,
      message: 'Outreach email updated.',
      data: { outreach },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/approve', async (req, res, next) => {
  try {
    const outreach = await OutreachEmail.findByPk(req.params.id, {
      include: [{
        model: Business,
        as: 'business',
        include: [{ model: Campaign, as: 'campaign', where: { user_id: req.user.id } }],
      }],
    });

    if (!outreach) {
      return res.status(404).json({ success: false, message: 'Outreach email not found.' });
    }

    if (outreach.status !== 'draft') {
      return res.status(400).json({ success: false, message: 'Only draft emails can be approved.' });
    }

    await outreach.update({ status: 'approved' });

    logger.info(`Outreach email approved: ${outreach.id} for ${outreach.to_email}`);

    res.json({
      success: true,
      message: 'Email approved.',
      data: { outreach },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/reject', async (req, res, next) => {
  try {
    const outreach = await OutreachEmail.findByPk(req.params.id, {
      include: [{
        model: Business,
        as: 'business',
        include: [{ model: Campaign, as: 'campaign', where: { user_id: req.user.id } }],
      }],
    });

    if (!outreach) {
      return res.status(404).json({ success: false, message: 'Outreach email not found.' });
    }

    await outreach.update({ status: 'rejected' });

    res.json({
      success: true,
      message: 'Email rejected.',
      data: { outreach },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/send', async (req, res, next) => {
  try {
    const outreach = await OutreachEmail.findByPk(req.params.id, {
      include: [{
        model: Business,
        as: 'business',
        include: [{ model: Campaign, as: 'campaign', where: { user_id: req.user.id } }],
      }],
    });

    if (!outreach) {
      return res.status(404).json({ success: false, message: 'Outreach email not found.' });
    }

    if (outreach.status !== 'approved') {
      return res.status(400).json({ success: false, message: 'Email must be approved before sending.' });
    }

    await outreach.update({ status: 'queued' });

    const emailQueue = getEmailQueue();
    await emailQueue.add('send-outreach', {
      outreachId: outreach.id,
      userId: req.user.id,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });

    logger.info(`Outreach email queued for sending: ${outreach.id}`);

    res.json({
      success: true,
      message: 'Email queued for sending.',
      data: { outreach },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/approve-bulk', async (req, res, next) => {
  try {
    const { outreach_ids } = req.body;
    if (!outreach_ids || !Array.isArray(outreach_ids)) {
      return res.status(400).json({ success: false, message: 'Provide outreach_ids array.' });
    }

    const [updated] = await OutreachEmail.update(
      { status: 'approved' },
      {
        where: {
          id: outreach_ids,
          status: 'draft',
        },
      }
    );

    res.json({
      success: true,
      message: `${updated} email(s) approved.`,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/send-bulk', async (req, res, next) => {
  try {
    const { outreach_ids } = req.body;
    if (!outreach_ids || !Array.isArray(outreach_ids)) {
      return res.status(400).json({ success: false, message: 'Provide outreach_ids array.' });
    }

    const outreachEmails = await OutreachEmail.findAll({
      where: { id: outreach_ids, status: 'approved' },
    });

    const emailQueue = getEmailQueue();
    let queued = 0;

    for (const outreach of outreachEmails) {
      await outreach.update({ status: 'queued' });
      await emailQueue.add('send-outreach', {
        outreachId: outreach.id,
        userId: req.user.id,
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      });
      queued++;
    }

    res.json({
      success: true,
      message: `${queued} email(s) queued for sending.`,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
