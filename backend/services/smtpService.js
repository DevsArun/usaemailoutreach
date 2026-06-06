const nodemailer = require('nodemailer');
const { SmtpAccount, OutreachEmail, Followup, AnalyticsEvent, Business } = require('../models');
const logger = require('../utils/logger');

const transporterCache = new Map();

function getTransporter(account) {
  const key = `${account.id}_${account.email}`;
  if (transporterCache.has(key)) {
    return transporterCache.get(key);
  }

  const transporter = nodemailer.createTransport({
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: {
      user: account.email,
      pass: account.password,
    },
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    rateDelta: 2000,
    rateLimit: 5,
  });

  transporterCache.set(key, transporter);
  return transporter;
}

async function getAvailableSmtpAccount(userId) {
  const today = new Date().toISOString().split('T')[0];

  const accounts = await SmtpAccount.findAll({
    where: {
      user_id: userId,
      status: 'active',
    },
    order: [['sent_today', 'ASC']],
  });

  for (const account of accounts) {
    if (account.last_reset !== today) {
      await account.update({ sent_today: 0, last_reset: today });
    }

    if (account.sent_today < account.daily_limit) {
      return account;
    }
  }

  return null;
}

async function sendOutreachEmail(outreachId, userId) {
  const outreach = await OutreachEmail.findByPk(outreachId, {
    include: [{ model: Business, as: 'business' }],
  });

  if (!outreach) {
    throw new Error(`Outreach email ${outreachId} not found`);
  }

  const account = await getAvailableSmtpAccount(userId);
  if (!account) {
    await outreach.update({ status: 'failed', error_message: 'No available SMTP accounts' });
    throw new Error('No available SMTP accounts with remaining daily limit');
  }

  const transporter = getTransporter(account);

  const mailOptions = {
    from: `"${account.email.split('@')[0]}" <${account.email}>`,
    to: outreach.to_email,
    subject: outreach.subject,
    html: formatEmailHtml(outreach.body),
    text: outreach.body,
    headers: {
      'List-Unsubscribe': `<mailto:${account.email}?subject=unsubscribe>`,
      'X-Campaign-ID': outreach.campaign_id.toString(),
      'X-Outreach-ID': outreach.id.toString(),
    },
  };

  try {
    const info = await transporter.sendMail(mailOptions);

    await outreach.update({
      status: 'sent',
      sent_at: new Date(),
      from_email: account.email,
      smtp_account_id: account.id,
    });

    await account.update({ sent_today: account.sent_today + 1 });

    if (outreach.business) {
      const currentStage = outreach.business.pipeline_stage;
      if (['discovered', 'analyzed'].includes(currentStage)) {
        await outreach.business.update({
          pipeline_stage: 'email_sent',
          pipeline_updated_at: new Date(),
        });
      }
    }

    await AnalyticsEvent.create({
      campaign_id: outreach.campaign_id,
      event_type: 'email_sent',
      metadata: {
        outreach_id: outreach.id,
        to_email: outreach.to_email,
        smtp_account: account.email,
        message_id: info.messageId,
      },
    });

    logger.info(`Email sent: ${outreach.id} to ${outreach.to_email} via ${account.email}`);
    return info;
  } catch (error) {
    await outreach.update({
      status: 'failed',
      error_message: error.message,
    });

    if (error.responseCode >= 500) {
      await account.update({
        status: 'error',
        error_message: error.message,
      });
      transporterCache.delete(`${account.id}_${account.email}`);
    }

    logger.error(`Email send failed: ${outreach.id} - ${error.message}`);
    throw error;
  }
}

async function sendFollowupEmail(followupId, outreachId, userId) {
  const followup = await Followup.findByPk(followupId, {
    include: [{
      model: OutreachEmail,
      as: 'outreach',
      include: [{ model: Business, as: 'business' }],
    }],
  });

  if (!followup) {
    throw new Error(`Followup ${followupId} not found`);
  }

  const account = await getAvailableSmtpAccount(userId);
  if (!account) {
    await followup.update({ status: 'failed' });
    throw new Error('No available SMTP accounts');
  }

  const transporter = getTransporter(account);

  const mailOptions = {
    from: `"${account.email.split('@')[0]}" <${account.email}>`,
    to: followup.outreach.to_email,
    subject: followup.subject || `Re: ${followup.outreach.subject}`,
    html: formatEmailHtml(followup.body),
    text: followup.body,
    headers: {
      'List-Unsubscribe': `<mailto:${account.email}?subject=unsubscribe>`,
    },
  };

  try {
    const info = await transporter.sendMail(mailOptions);

    await followup.update({
      status: 'sent',
      sent_at: new Date(),
    });

    await account.update({ sent_today: account.sent_today + 1 });

    logger.info(`Follow-up sent: ${followup.id} to ${followup.outreach.to_email}`);
    return info;
  } catch (error) {
    await followup.update({ status: 'failed' });
    logger.error(`Follow-up send failed: ${followup.id} - ${error.message}`);
    throw error;
  }
}

function formatEmailHtml(text) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const htmlBody = escaped.replace(/\n/g, '<br>');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  ${htmlBody}
  <br><br>
  <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
  <p style="font-size: 11px; color: #999;">
    If you'd prefer not to receive these emails, simply reply with "unsubscribe".
  </p>
</body>
</html>`;
}

module.exports = {
  sendOutreachEmail,
  sendFollowupEmail,
  getAvailableSmtpAccount,
};
