const { body, param, query, validationResult } = require('express-validator');

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array().map(err => ({
        field: err.path,
        message: err.msg,
      })),
    });
  }
  next();
}

const registerValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  validate,
];

const loginValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password required'),
  validate,
];

const campaignValidation = [
  body('query').trim().isLength({ min: 3 }).withMessage('Search query must be at least 3 characters'),
  body('settings').optional().isObject().withMessage('Settings must be an object'),
  body('settings.sources').optional().isArray().withMessage('Sources must be an array'),
  body('settings.max_results').optional().isInt({ min: 1, max: 10000 }).withMessage('Max results must be 1-10000'),
  validate,
];

const smtpValidation = [
  body('provider').isIn(['gmail', 'outlook', 'custom']).withMessage('Provider must be gmail, outlook, or custom'),
  body('email').isEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password required'),
  body('host').optional().isString(),
  body('port').optional().isInt({ min: 1, max: 65535 }),
  body('daily_limit').optional().isInt({ min: 1, max: 10000 }).withMessage('Daily limit must be 1-10000'),
  validate,
];

const groqKeyValidation = [
  body('api_key').matches(/^gsk_/).withMessage('Invalid Groq API key format'),
  validate,
];

const outreachEditValidation = [
  body('subject').optional().trim().isLength({ min: 1 }).withMessage('Subject cannot be empty'),
  body('body').optional().trim().isLength({ min: 1 }).withMessage('Body cannot be empty'),
  validate,
];

const pipelineUpdateValidation = [
  body('stage').isIn([
    'discovered', 'analyzed', 'email_sent', 'opened',
    'replied', 'interested', 'meeting_scheduled',
    'proposal_sent', 'won', 'lost'
  ]).withMessage('Invalid pipeline stage'),
  body('notes').optional().isString(),
  validate,
];

const paginationValidation = [
  query('page').optional().isInt({ min: 1 }).toInt().withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 500 }).toInt().withMessage('Limit must be 1-500'),
  validate,
];

module.exports = {
  validate,
  registerValidation,
  loginValidation,
  campaignValidation,
  smtpValidation,
  groqKeyValidation,
  outreachEditValidation,
  pipelineUpdateValidation,
  paginationValidation,
};
