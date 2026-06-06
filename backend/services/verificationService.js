const dns = require('dns').promises;
const net = require('net');
const logger = require('../utils/logger');

async function verifyEmail(emailAddress) {
  const result = {
    email: emailAddress,
    status: 'pending',
    details: {},
  };

  try {
    const domain = emailAddress.split('@')[1];
    if (!domain) {
      result.status = 'invalid';
      result.details.reason = 'Invalid email format';
      return result;
    }

    let mxRecords;
    try {
      mxRecords = await dns.resolveMx(domain);
      result.details.mx_records = mxRecords.map(r => r.exchange);
    } catch (err) {
      result.status = 'invalid';
      result.details.reason = 'No MX records found for domain';
      return result;
    }

    if (!mxRecords || mxRecords.length === 0) {
      result.status = 'invalid';
      result.details.reason = 'No MX records found';
      return result;
    }

    mxRecords.sort((a, b) => a.priority - b.priority);
    const primaryMx = mxRecords[0].exchange;

    try {
      const smtpResult = await smtpVerify(primaryMx, emailAddress);
      result.details.smtp = smtpResult;

      if (smtpResult.valid) {
        result.status = 'valid';
      } else if (smtpResult.catchAll) {
        result.status = 'catch_all';
      } else {
        result.status = 'invalid';
      }
    } catch (err) {
      result.status = 'risky';
      result.details.reason = `SMTP verification inconclusive: ${err.message}`;
      result.details.smtp_error = err.message;
    }

    const disposableDomains = [
      'guerrillamail.com', 'mailinator.com', 'tempmail.com', 'throwaway.email',
      'yopmail.com', 'sharklasers.com', 'guerrillamailblock.com', 'grr.la',
      'dispostable.com', 'trashmail.com', 'mailnesia.com', 'maildrop.cc',
      'temp-mail.org', 'fakeinbox.com',
    ];

    if (disposableDomains.includes(domain.toLowerCase())) {
      result.status = 'risky';
      result.details.disposable = true;
    }

  } catch (error) {
    logger.error(`Email verification error for ${emailAddress}:`, error);
    result.status = 'risky';
    result.details.error = error.message;
  }

  return result;
}

function smtpVerify(mxHost, emailAddress) {
  return new Promise((resolve, reject) => {
    const timeout = 10000;
    let resolved = false;

    const socket = net.createConnection(25, mxHost);

    socket.setTimeout(timeout);

    const responses = [];
    let step = 0;

    const commands = [
      null,
      `EHLO verify.leadforge.ai\r\n`,
      `MAIL FROM:<verify@leadforge.ai>\r\n`,
      `RCPT TO:<${emailAddress}>\r\n`,
      `RCPT TO:<randomnonexistent123456789@${emailAddress.split('@')[1]}>\r\n`,
      `QUIT\r\n`,
    ];

    socket.on('data', (data) => {
      const response = data.toString();
      responses.push(response);
      const code = parseInt(response.substring(0, 3));

      step++;

      if (step === 1 && code !== 220) {
        finish({ valid: false, reason: 'Server rejected connection' });
        return;
      }

      if (step === 4) {
        if (code === 250) {
          socket.write(commands[4]);
          return;
        } else if (code === 550 || code === 553 || code === 551) {
          finish({ valid: false, reason: 'Mailbox does not exist' });
          return;
        } else {
          finish({ valid: false, reason: `RCPT TO returned: ${code}`, catchAll: false });
          return;
        }
      }

      if (step === 5) {
        const catchAll = code === 250;
        finish({ valid: true, catchAll, reason: catchAll ? 'Domain accepts all emails' : 'Mailbox exists' });
        return;
      }

      if (step < commands.length && commands[step]) {
        socket.write(commands[step]);
      }
    });

    socket.on('timeout', () => {
      finish(null, new Error('SMTP connection timeout'));
    });

    socket.on('error', (err) => {
      finish(null, err);
    });

    function finish(result, error) {
      if (resolved) return;
      resolved = true;
      socket.destroy();

      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    }
  });
}

async function verifyEmailBatch(emails) {
  const results = [];
  for (const email of emails) {
    const result = await verifyEmail(email);
    results.push(result);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return results;
}

module.exports = {
  verifyEmail,
  verifyEmailBatch,
};
