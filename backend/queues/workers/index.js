/* ============================================
   LeadForge AI — BullMQ Workers
   Only started when Redis is available. Each worker simply
   delegates to the shared processors so the behaviour is
   identical to the in-process fallback path.
   ============================================ */

const { Worker } = require('bullmq');
const { getSharedConnection, isUsingRedis } = require('../index');
const { processJob } = require('../processors');
const { Campaign } = require('../../models');
const logger = require('../../utils/logger');

let workers = [];

const WORKER_CONFIG = [
  { name: 'campaign-queue', concurrency: 2, limiter: { max: 2, duration: 1000 } },
  { name: 'analyze-queue', concurrency: 5, limiter: { max: 10, duration: 60000 } },
  { name: 'verify-queue', concurrency: 3, limiter: { max: 5, duration: 10000 } },
  { name: 'email-queue', concurrency: 2, limiter: { max: 3, duration: 10000 } },
  { name: 'outreach-queue', concurrency: 3, limiter: { max: 10, duration: 60000 } },
  { name: 'followup-queue', concurrency: 3 },
];

async function initWorkers() {
  if (!isUsingRedis()) {
    logger.info('Skipping BullMQ workers — running in in-process mode.');
    return;
  }

  const connection = getSharedConnection();
  if (!connection) {
    logger.warn('No Redis connection available; workers not started.');
    return;
  }

  workers = WORKER_CONFIG.map(({ name, concurrency, limiter }) => {
    const opts = { connection, concurrency };
    if (limiter) opts.limiter = limiter;

    const worker = new Worker(name, async (job) => {
      logger.info(`Processing job ${job.id} on ${name} (${job.name})`);
      return processJob(name, job.name, job.data);
    }, opts);

    worker.on('completed', (job) => {
      logger.debug(`Job ${job.id} completed on ${name}`);
    });

    worker.on('failed', async (job, err) => {
      logger.error(`Job ${job?.id} failed on ${name}: ${err.message}`);
      if (job?.data?.campaignId) {
        try {
          await Campaign.update(
            { status: 'failed', error_message: err.message },
            { where: { id: job.data.campaignId } }
          );
        } catch (e) {
          logger.error('Could not update failed campaign:', e.message);
        }
      }
    });

    worker.on('error', (err) => {
      logger.error(`Worker ${name} error:`, err.message);
    });

    return worker;
  });

  logger.info(`${workers.length} BullMQ workers started.`);
}

async function shutdownWorkers() {
  for (const worker of workers) {
    try { await worker.close(); } catch (e) { /* ignore */ }
  }
  workers = [];
  logger.info('All workers shut down.');
}

module.exports = { initWorkers, shutdownWorkers };
