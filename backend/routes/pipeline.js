const express = require('express');
const { Business, Campaign } = require('../models');
const authenticate = require('../middleware/auth');
const { pipelineUpdateValidation } = require('../utils/validators');
const { Op } = require('sequelize');

const router = express.Router();
router.use(authenticate);

const PIPELINE_STAGES = [
  'discovered', 'analyzed', 'email_sent', 'opened',
  'replied', 'interested', 'meeting_scheduled',
  'proposal_sent', 'won', 'lost',
];

router.get('/', async (req, res, next) => {
  try {
    const { campaign_id } = req.query;

    const campaignWhere = { user_id: req.user.id };
    if (campaign_id) campaignWhere.id = campaign_id;

    const pipeline = {};
    for (const stage of PIPELINE_STAGES) {
      pipeline[stage] = [];
    }

    const businesses = await Business.findAll({
      include: [{
        model: Campaign,
        as: 'campaign',
        where: campaignWhere,
        attributes: ['id', 'query'],
      }],
      attributes: ['id', 'name', 'category', 'website', 'lead_score', 'pipeline_stage', 'pipeline_notes', 'pipeline_updated_at', 'phone'],
      order: [['lead_score', 'DESC']],
    });

    for (const biz of businesses) {
      const stage = biz.pipeline_stage || 'discovered';
      if (pipeline[stage]) {
        pipeline[stage].push(biz);
      }
    }

    const stageCounts = {};
    for (const stage of PIPELINE_STAGES) {
      stageCounts[stage] = pipeline[stage].length;
    }

    res.json({
      success: true,
      data: {
        pipeline,
        stageCounts,
        stages: PIPELINE_STAGES,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', pipelineUpdateValidation, async (req, res, next) => {
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
      pipeline_notes: notes !== undefined ? notes : business.pipeline_notes,
      pipeline_updated_at: new Date(),
    });

    res.json({
      success: true,
      message: `Moved to ${stage}.`,
      data: { business },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/stats', async (req, res, next) => {
  try {
    const { campaign_id } = req.query;
    const campaignWhere = { user_id: req.user.id };
    if (campaign_id) campaignWhere.id = campaign_id;

    const stats = await Business.findAll({
      attributes: [
        'pipeline_stage',
        [Business.sequelize.fn('COUNT', Business.sequelize.col('businesses.id')), 'count'],
        [Business.sequelize.fn('AVG', Business.sequelize.col('lead_score')), 'avg_score'],
      ],
      include: [{
        model: Campaign,
        as: 'campaign',
        where: campaignWhere,
        attributes: [],
      }],
      group: ['pipeline_stage'],
      raw: true,
    });

    const conversionFunnel = PIPELINE_STAGES.map(stage => {
      const stat = stats.find(s => s.pipeline_stage === stage);
      return {
        stage,
        count: stat ? parseInt(stat.count) : 0,
        avgScore: stat ? Math.round(parseFloat(stat.avg_score) || 0) : 0,
      };
    });

    const totalDiscovered = conversionFunnel[0].count || 1;
    const wonCount = conversionFunnel.find(s => s.stage === 'won')?.count || 0;

    res.json({
      success: true,
      data: {
        funnel: conversionFunnel,
        conversionRate: ((wonCount / totalDiscovered) * 100).toFixed(2),
        totalLeads: stats.reduce((sum, s) => sum + parseInt(s.count), 0),
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
