const express = require('express');
const nodemailer = require('nodemailer');
const { SmtpAccount, GroqKey, Setting } = require('../models');
const authenticate = require('../middleware/auth');
const { smtpValidation, groqKeyValidation } = require('../utils/validators');
const { groqKeyManager } = require('../config/groq');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authenticate);

// Resolve the correct SMTP + IMAP settings from the email domain (preferred)
// so a Gmail address can never end up with an Outlook host, etc.
function resolveMailConfig({ email, provider, host, port }) {
  const domain = (String(email).split('@')[1] || '').toLowerCase();
  const known = {
    'gmail.com':      { provider: 'gmail',   host: 'smtp.gmail.com',        port: 465, secure: true,  imap_host: 'imap.gmail.com' },
    'googlemail.com': { provider: 'gmail',   host: 'smtp.gmail.com',        port: 465, secure: true,  imap_host: 'imap.gmail.com' },
    'outlook.com':    { provider: 'outlook', host: 'smtp-mail.outlook.com', port: 587, secure: false, imap_host: 'outlook.office365.com' },
    'hotmail.com':    { provider: 'outlook', host: 'smtp-mail.outlook.com', port: 587, secure: false, imap_host: 'outlook.office365.com' },
    'live.com':       { provider: 'outlook', host: 'smtp-mail.outlook.com', port: 587, secure: false, imap_host: 'outlook.office365.com' },
    'msn.com':        { provider: 'outlook', host: 'smtp-mail.outlook.com', port: 587, secure: false, imap_host: 'outlook.office365.com' },
    'yahoo.com':      { provider: 'custom',  host: 'smtp.mail.yahoo.com',   port: 465, secure: true,  imap_host: 'imap.mail.yahoo.com' },
    'zoho.com':       { provider: 'custom',  host: 'smtp.zoho.com',         port: 465, secure: true,  imap_host: 'imap.zoho.com' },
  };
  if (known[domain]) return known[domain];

  // Custom / unknown domain: trust the provided host/port.
  const p = parseInt(port) || 587;
  return {
    provider: provider || 'custom',
    host: host || '',
    port: p,
    secure: p === 465,
    imap_host: host ? host.replace(/^smtp\./i, 'imap.') : null,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const settings = await Setting.findAll({
      where: { user_id: req.user.id },
    });

    const settingsMap = {};
    settings.forEach(s => { settingsMap[s.key] = s.value; });

    res.json({
      success: true,
      data: { settings: settingsMap },
    });
  } catch (error) {
    next(error);
  }
});

router.put('/', async (req, res, next) => {
  try {
    const updates = req.body;
    for (const [key, value] of Object.entries(updates)) {
      await Setting.upsert({
        user_id: req.user.id,
        key,
        value,
      });
    }

    res.json({
      success: true,
      message: 'Settings updated.',
    });
  } catch (error) {
    next(error);
  }
});

router.get('/smtp', async (req, res, next) => {
  try {
    const accounts = await SmtpAccount.findAll({
      where: { user_id: req.user.id },
      attributes: { exclude: ['password'] },
      order: [['created_at', 'DESC']],
    });

    res.json({
      success: true,
      data: { accounts },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/smtp', smtpValidation, async (req, res, next) => {
  try {
    const { provider, email, password, host, port, daily_limit } = req.body;

    // Auto-resolve correct host/port/secure/IMAP from the email domain so a
    // wrong provider selection can't break the connection.
    const cfg = resolveMailConfig({ email, provider, host, port });

    if (!cfg.host) {
      return res.status(400).json({ success: false, message: 'SMTP host could not be determined. For a custom domain, enter the SMTP host.' });
    }

    const account = await SmtpAccount.create({
      user_id: req.user.id,
      provider: cfg.provider,
      email,
      password,
      host: cfg.host,
      port: cfg.port || 587,
      secure: cfg.secure,
      imap_host: cfg.imap_host || null,
      daily_limit: daily_limit || 500,
    });

    logger.info(`SMTP account added: ${email}`);

    res.status(201).json({
      success: true,
      message: 'SMTP account added.',
      data: {
        account: {
          id: account.id,
          provider: account.provider,
          email: account.email,
          host: account.host,
          port: account.port,
          daily_limit: account.daily_limit,
          status: account.status,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

router.put('/smtp/:id', async (req, res, next) => {
  try {
    const account = await SmtpAccount.findOne({
      where: { id: req.params.id, user_id: req.user.id },
    });

    if (!account) {
      return res.status(404).json({ success: false, message: 'SMTP account not found.' });
    }

    const { email, password, host, port, daily_limit, status, imap_host, imap_port } = req.body;
    await account.update({
      ...(email && { email }),
      ...(password && { password }),
      ...(host && { host }),
      ...(port && { port }),
      ...(daily_limit && { daily_limit }),
      ...(status && { status }),
      ...(imap_host !== undefined && { imap_host }),
      ...(imap_port !== undefined && { imap_port }),
    });

    res.json({
      success: true,
      message: 'SMTP account updated.',
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/smtp/:id', async (req, res, next) => {
  try {
    const account = await SmtpAccount.findOne({
      where: { id: req.params.id, user_id: req.user.id },
    });

    if (!account) {
      return res.status(404).json({ success: false, message: 'SMTP account not found.' });
    }

    await account.destroy();
    logger.info(`SMTP account deleted: ${account.email}`);

    res.json({
      success: true,
      message: 'SMTP account deleted.',
    });
  } catch (error) {
    next(error);
  }
});

router.post('/smtp/:id/test', async (req, res, next) => {
  try {
    const account = await SmtpAccount.findOne({
      where: { id: req.params.id, user_id: req.user.id },
    });

    if (!account) {
      return res.status(404).json({ success: false, message: 'SMTP account not found.' });
    }

    const transporter = nodemailer.createTransport({
      host: account.host,
      port: account.port,
      secure: account.secure,
      auth: {
        user: account.email,
        pass: account.password,
      },
      connectionTimeout: 12000,
      greetingTimeout: 12000,
      socketTimeout: 12000,
      tls: { rejectUnauthorized: false },
    });

    // Hard timeout guarantees the request always responds (nodemailer's
    // verify can otherwise hang if the port is filtered with no RST).
    await Promise.race([
      transporter.verify(),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('Connection timed out — the SMTP port may be blocked, or host/port is wrong.')),
        15000,
      )),
    ]);
    try { transporter.close(); } catch (e) { /* ignore */ }

    await account.update({ status: 'active', error_message: null });

    res.json({
      success: true,
      message: 'SMTP connection test successful.',
    });
  } catch (error) {
    await SmtpAccount.update(
      { status: 'error', error_message: error.message },
      { where: { id: req.params.id } }
    );

    res.status(400).json({
      success: false,
      message: `SMTP test failed: ${error.message}`,
    });
  }
});

router.get('/groq', async (req, res, next) => {
  try {
    const keys = await GroqKey.findAll({
      where: { user_id: req.user.id },
      attributes: ['id', 'label', 'usage_count', 'last_used', 'status', 'created_at',
        [GroqKey.sequelize.fn('CONCAT', GroqKey.sequelize.fn('LEFT', GroqKey.sequelize.col('api_key'), 10), '...'), 'key_preview']
      ],
      order: [['created_at', 'DESC']],
    });

    res.json({
      success: true,
      data: {
        keys,
        rotation_status: groqKeyManager.getStatus(),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/groq', groqKeyValidation, async (req, res, next) => {
  try {
    const { api_key, label } = req.body;

    const existing = await GroqKey.findOne({
      where: { user_id: req.user.id, api_key },
    });

    if (existing) {
      return res.status(409).json({ success: false, message: 'This API key already exists.' });
    }

    const key = await GroqKey.create({
      user_id: req.user.id,
      api_key,
      label: label || `Key ${await GroqKey.count({ where: { user_id: req.user.id } }) + 1}`,
    });

    groqKeyManager.addKey(api_key);

    logger.info(`Groq API key added: ${api_key.substring(0, 10)}...`);

    res.status(201).json({
      success: true,
      message: 'Groq API key added.',
      data: {
        key: {
          id: key.id,
          label: key.label,
          key_preview: api_key.substring(0, 10) + '...',
          status: key.status,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/groq/:id', async (req, res, next) => {
  try {
    const key = await GroqKey.findOne({
      where: { id: req.params.id, user_id: req.user.id },
    });

    if (!key) {
      return res.status(404).json({ success: false, message: 'Groq API key not found.' });
    }

    groqKeyManager.removeKey(key.api_key);
    await key.destroy();

    logger.info(`Groq API key deleted: ${key.id}`);

    res.json({
      success: true,
      message: 'Groq API key deleted.',
    });
  } catch (error) {
    next(error);
  }
});

router.get('/services', async (req, res, next) => {
  try {
    const defaultServices = [
      { id: 'website_dev', name: 'Website Development', description: 'Custom website design and development', active: true },
      { id: 'website_redesign', name: 'Website Redesign', description: 'Modern redesign of existing websites', active: true },
      { id: 'crm_dev', name: 'CRM Development', description: 'Custom CRM solutions', active: true },
      { id: 'whatsapp_automation', name: 'WhatsApp Automation', description: 'WhatsApp Business API integration', active: true },
      { id: 'ai_agents', name: 'AI Agents', description: 'Custom AI agent development', active: true },
      { id: 'chatbots', name: 'Chatbots', description: 'AI-powered chatbot solutions', active: true },
      { id: 'review_mgmt', name: 'Review Management', description: 'Online reputation management', active: true },
      { id: 'lead_mgmt', name: 'Lead Management', description: 'Lead tracking and nurturing systems', active: true },
      { id: 'booking_system', name: 'Booking System', description: 'Online appointment scheduling', active: true },
      { id: 'chrome_extension', name: 'Chrome Extension', description: 'Custom browser extensions', active: true },
      { id: 'mobile_app', name: 'Mobile App', description: 'iOS and Android applications', active: true },
      { id: 'web_app', name: 'Web Application', description: 'Full-stack web applications', active: true },
      { id: 'internal_tools', name: 'Internal Tools', description: 'Custom business tools', active: true },
      { id: 'custom_software', name: 'Custom Software', description: 'Bespoke software solutions', active: true },
      { id: 'api_integration', name: 'API Integration', description: 'Third-party API connections', active: true },
    ];

    const savedServices = await Setting.findOne({
      where: { user_id: req.user.id, key: 'services_catalog' },
    });

    res.json({
      success: true,
      data: {
        services: savedServices ? savedServices.value : defaultServices,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
