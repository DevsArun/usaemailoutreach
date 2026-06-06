const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

let logger;
try { logger = require('./utils/logger'); } catch(e) { logger = console; }

const app = express();
const PORT = process.env.PORT || 7860;

// ─── MIDDLEWARE ───────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

try { app.use(require('./middleware/rateLimiter')); } catch(e) { logger.warn('Rate limiter skipped:', e.message); }

// ─── SERVE FRONTEND ──────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ─── HEALTH CHECK ────────────────────────────────────────────────────
let appStatus = { db: false, redis: false, ready: false };

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: appStatus,
  });
});

// ─── API ROUTES (loaded immediately) ─────────────────────────────────
const routeModules = [
  ['/api/auth', './routes/auth'],
  ['/api/campaigns', './routes/campaigns'],
  ['/api/businesses', './routes/businesses'],
  ['/api/emails', './routes/emails'],
  ['/api/outreach', './routes/outreach'],
  ['/api/analytics', './routes/analytics'],
  ['/api/settings', './routes/settings'],
  ['/api/pipeline', './routes/pipeline'],
  ['/api/replies', './routes/replies'],
];

routeModules.forEach(([routePath, modulePath]) => {
  try {
    app.use(routePath, require(modulePath));
    logger.info(`  ✅ Route loaded: ${routePath}`);
  } catch (err) {
    logger.error(`  ❌ Route ${routePath} failed to load:`);
    logger.error(`     Module: ${modulePath}`);
    logger.error(`     Error: ${err.message}`);
    logger.error(`     Stack: ${err.stack}`);
    // Provide a fallback so the user gets a clear error instead of 404
    app.use(routePath, (req, res) => {
      res.status(503).json({ success: false, message: `Service ${routePath} temporarily unavailable: ${err.message}` });
    });
  }
});

// API 404 handler
app.all('/api/*', (req, res) => {
  res.status(404).json({ success: false, message: `API endpoint not found: ${req.method} ${req.path}` });
});

// Frontend catch-all (MUST be last)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

try { app.use(require('./middleware/errorHandler')); } catch(e) { logger.warn('Error handler skipped:', e.message); }

// ─── START SERVER ────────────────────────────────────────────────────
const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info(`✅ LeadForge AI running on http://0.0.0.0:${PORT}`);

  // Keep-Alive Ping
  setInterval(() => {
    fetch(`http://localhost:${PORT}/api/health`).catch(() => {});
  }, 10 * 60 * 1000);

  // Connect DB and Redis in background
  connectServices();
});

// ─── CONNECT DB + REDIS IN BACKGROUND ────────────────────────────────
async function connectServices() {
  // Database
  try {
    const { sequelize } = require('./models');

    // Force IPv4: resolve hostname to IPv4 IP (HF Spaces doesn't support IPv6)
    const dns = require('dns');
    const host = sequelize.config.host;
    if (host && !host.match(/^\d+\.\d+\.\d+\.\d+$/)) {
      try {
        const ipv4 = await new Promise((resolve, reject) => {
          dns.resolve4(host, (err, addresses) => {
            if (err) reject(err);
            else resolve(addresses[0]);
          });
        });
        logger.info(`DNS: Resolved ${host} → ${ipv4} (IPv4)`);
        sequelize.config.host = ipv4;
        if (sequelize.options) sequelize.options.host = ipv4;
        if (sequelize.connectionManager && sequelize.connectionManager.config) {
          sequelize.connectionManager.config.host = ipv4;
        }
      } catch (dnsErr) {
        logger.warn(`DNS: Could not resolve IPv4 for ${host}: ${dnsErr.message}`);
        logger.warn('DNS: Will try connecting with hostname (may fail on IPv6-only)');
      }
    }

    for (let attempt = 1; attempt <= 30; attempt++) {
      try {
        await sequelize.authenticate();
        logger.info(`✅ Database connected (attempt ${attempt})`);
        appStatus.db = true;
        await sequelize.sync({ alter: true });
        logger.info('✅ Database synced');

        // Reset campaigns stuck as 'running' from previous server crash
        try {
          const { Campaign } = require('./models');
          const [resetCount] = await Campaign.update(
            { status: 'failed', error_message: 'Server restarted while campaign was running' },
            { where: { status: 'running' } }
          );
          if (resetCount > 0) logger.info(`Reset ${resetCount} stuck campaigns to 'failed'`);
        } catch(e) { logger.warn('Could not reset stuck campaigns:', e.message); }

        break;
      } catch (err) {
        logger.error(`❌ DB attempt ${attempt}/30: ${err.message}`);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  } catch (err) {
    logger.error('❌ Models module error:', err.message);
  }

  // Redis + BullMQ (optional — falls back to in-process jobs if unavailable)
  try {
    const { initQueues, isUsingRedis } = require('./queues');
    const { initWorkers } = require('./queues/workers');

    await initQueues();
    if (isUsingRedis()) {
      await initWorkers();
      appStatus.redis = true;
      logger.info('✅ Queues & Workers started (Redis mode)');
    } else {
      appStatus.redis = false;
      logger.info('✅ Job runner ready (in-process mode, no Redis required)');
    }
  } catch (err) {
    logger.error('❌ Queues module error:', err.message);
    logger.warn('Continuing in in-process job mode.');
  }

  appStatus.ready = true;
  logger.info('🚀 All services ready!');
}

// ─── SIGNAL HANDLERS ─────────────────────────────────────────────────
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });
process.on('unhandledRejection', (reason) => { logger.error('Unhandled Rejection:', reason); });
process.on('uncaughtException', (err) => { logger.error('Uncaught Exception:', err); });
