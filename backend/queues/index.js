/* ============================================
   LeadForge AI — Queue Manager
   Uses BullMQ + Redis when REDIS_URL is configured and
   reachable. Otherwise transparently falls back to
   in-process job execution so the platform works fully
   even without a Redis instance (e.g. single-container
   Hugging Face Spaces deployments).
   ============================================ */

const { Queue } = require('bullmq');
const { createRedisConnection } = require('../config/redis');
const logger = require('../utils/logger');
const { processJob } = require('./processors');

const QUEUE_NAMES = [
  'campaign-queue',
  'analyze-queue',
  'verify-queue',
  'email-queue',
  'outreach-queue',
  'followup-queue',
];

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 500 },
};

const queues = {};
let sharedConnection = null;
let useRedis = false;

/**
 * Initialise the queue subsystem. Tries Redis first; on any failure
 * (no URL, unreachable, auth error) it falls back to in-process mode.
 * This function NEVER throws — the app must always start.
 */
async function initQueues() {
  const url = (process.env.REDIS_URL || '').trim();

  if (!url) {
    useRedis = false;
    logger.warn('REDIS_URL not configured. Running jobs in-process (no Redis required).');
    return;
  }

  try {
    const connection = createRedisConnection();

    // Verify the connection is actually usable before committing to it.
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Redis connection timeout')), 8000);
      const onReady = () => { cleanup(); resolve(); };
      const onError = (err) => { cleanup(); reject(err); };
      function cleanup() {
        clearTimeout(timer);
        connection.removeListener('ready', onReady);
        connection.removeListener('error', onError);
      }
      connection.once('ready', onReady);
      connection.once('error', onError);
    });

    sharedConnection = connection;
    for (const name of QUEUE_NAMES) {
      queues[name] = new Queue(name, { connection: sharedConnection, defaultJobOptions });
    }
    useRedis = true;
    logger.info('BullMQ queues initialised (Redis connected).');
  } catch (err) {
    useRedis = false;
    logger.warn(`Redis unavailable (${err.message}). Falling back to in-process job execution.`);
  }
}

/**
 * Enqueue a job. Uses BullMQ when Redis is available, otherwise runs
 * the job in-process on the next tick (non-blocking, fire-and-forget
 * with full error handling). Always resolves with a job descriptor so
 * callers never crash on a null queue.
 */
async function enqueue(queueName, jobName, data = {}, opts = {}) {
  if (useRedis && queues[queueName]) {
    return queues[queueName].add(jobName, data, { ...defaultJobOptions, ...opts });
  }

  // ── In-process fallback ──────────────────────────────────────────
  setImmediate(() => {
    processJob(queueName, jobName, data).catch(async (err) => {
      logger.error(`In-process job failed [${queueName}/${jobName}]: ${err.message}`);
      // If this was a campaign job, surface the failure on the campaign record.
      if (data && data.campaignId) {
        try {
          const { Campaign } = require('../models');
          await Campaign.update(
            { status: 'failed', error_message: err.message },
            { where: { id: data.campaignId } }
          );
        } catch (e) {
          logger.error('Could not update failed campaign:', e.message);
        }
      }
    });
  });

  return { id: `inproc-${queueName}-${Date.now()}`, inProcess: true };
}

function isUsingRedis() {
  return useRedis;
}

function getSharedConnection() {
  return sharedConnection;
}

// Backwards-compatible accessors (return the BullMQ queue or null).
function getCampaignQueue() { return queues['campaign-queue'] || null; }
function getAnalyzeQueue() { return queues['analyze-queue'] || null; }
function getVerifyQueue() { return queues['verify-queue'] || null; }
function getEmailQueue() { return queues['email-queue'] || null; }
function getOutreachQueue() { return queues['outreach-queue'] || null; }
function getFollowupQueue() { return queues['followup-queue'] || null; }

module.exports = {
  initQueues,
  enqueue,
  isUsingRedis,
  getSharedConnection,
  QUEUE_NAMES,
  getCampaignQueue,
  getAnalyzeQueue,
  getVerifyQueue,
  getEmailQueue,
  getOutreachQueue,
  getFollowupQueue,
};
