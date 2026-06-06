const { Queue } = require('bullmq');
const { createRedisConnection } = require('../config/redis');
const logger = require('../utils/logger');

let campaignQueue = null;
let analyzeQueue = null;
let verifyQueue = null;
let emailQueue = null;
let outreachQueue = null;
let followupQueue = null;

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 500 },
};

async function initQueues() {
  const connection = createRedisConnection();

  campaignQueue = new Queue('campaign-queue', { connection, defaultJobOptions });
  analyzeQueue = new Queue('analyze-queue', { connection, defaultJobOptions });
  verifyQueue = new Queue('verify-queue', { connection, defaultJobOptions });
  emailQueue = new Queue('email-queue', { connection, defaultJobOptions });
  outreachQueue = new Queue('outreach-queue', { connection, defaultJobOptions });
  followupQueue = new Queue('followup-queue', { connection, defaultJobOptions });

  logger.info('All BullMQ queues initialized.');
}

function getCampaignQueue() { return campaignQueue; }
function getAnalyzeQueue() { return analyzeQueue; }
function getVerifyQueue() { return verifyQueue; }
function getEmailQueue() { return emailQueue; }
function getOutreachQueue() { return outreachQueue; }
function getFollowupQueue() { return followupQueue; }

module.exports = {
  initQueues,
  getCampaignQueue,
  getAnalyzeQueue,
  getVerifyQueue,
  getEmailQueue,
  getOutreachQueue,
  getFollowupQueue,
};
