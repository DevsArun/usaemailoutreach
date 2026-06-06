const IORedis = require('ioredis');
const logger = require('../utils/logger');

let redisConnection = null;

function parseRedisUrl(url) {
  const isTLS = url.startsWith('rediss://');
  const withoutProtocol = url.replace(/^rediss?:\/\//, '');
  const atIndex = withoutProtocol.lastIndexOf('@');

  let password = null;
  let host = 'localhost';
  let port = 6379;

  if (atIndex !== -1) {
    const credentials = withoutProtocol.substring(0, atIndex);
    const hostPart = withoutProtocol.substring(atIndex + 1);
    const colonIndex = credentials.indexOf(':');
    password = colonIndex !== -1 ? credentials.substring(colonIndex + 1) : credentials;
    const [h, p] = hostPart.split(':');
    host = h || 'localhost';
    port = parseInt(p || '6379', 10);
  } else {
    const [h, p] = withoutProtocol.split(':');
    host = h || 'localhost';
    port = parseInt(p || '6379', 10);
  }

  // Force TLS for cloud Redis providers (Upstash, etc.)
  const needsTLS = isTLS || host.includes('upstash.io') || host.includes('redis.cloud');

  return { host, port, password, tls: needsTLS };
}

function getRedisOptions() {
  const url = (process.env.REDIS_URL || '').trim();

  if (url && url.includes('@')) {
    const parsed = parseRedisUrl(url);
    logger.info(`Redis Config: host=${parsed.host}, port=${parsed.port}, tls=${parsed.tls}`);

    const opts = {
      host: parsed.host,
      port: parsed.port,
      password: parsed.password,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
      retryStrategy(times) {
        const delay = Math.min(times * 200, 5000);
        return delay;
      },
    };

    if (parsed.tls) {
      opts.tls = { rejectUnauthorized: false };
    }

    return { opts };
  }

  return {
    opts: {
      host: 'localhost',
      port: 6379,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
      retryStrategy(times) {
        return Math.min(times * 200, 5000);
      },
    },
  };
}

function getRedisConnection() {
  if (!redisConnection) {
    const { opts } = getRedisOptions();
    redisConnection = new IORedis(opts);

    redisConnection.on('connect', () => {
      logger.info('Redis connection established.');
    });

    redisConnection.on('error', (err) => {
      logger.error('Redis connection error:', err.message);
    });

    redisConnection.on('close', () => {
      logger.warn('Redis connection closed.');
    });
  }
  return redisConnection;
}

function createRedisConnection() {
  const { opts } = getRedisOptions();
  return new IORedis({ ...opts, lazyConnect: false });
}

module.exports = { getRedisConnection, createRedisConnection };
