const { Sequelize } = require('sequelize');
const dns = require('dns');

// Force IPv4 — HF Spaces doesn't support IPv6
dns.setDefaultResultOrder('ipv4first');

let logger;
try { logger = require('../utils/logger'); } catch(e) { logger = console; }

const commonOptions = {
  dialect: 'postgres',
  logging: false,
  pool: { max: 5, min: 1, acquire: 60000, idle: 10000 },
  dialectOptions: {
    ssl: { require: true, rejectUnauthorized: false },
    connectTimeout: 30000,
  },
  define: { timestamps: true, underscored: true, freezeTableName: true },
};

let sequelize;
const dbUrl = (process.env.DATABASE_URL || '').trim();

if (dbUrl && dbUrl.includes('@')) {
  // Manual parsing — handles #, %, @ and other special chars in password
  const withoutProtocol = dbUrl.replace(/^postgres(ql)?:\/\//, '');
  const atIndex = withoutProtocol.lastIndexOf('@');  // last @ separates creds from host
  const credentials = withoutProtocol.substring(0, atIndex);
  const hostPart = withoutProtocol.substring(atIndex + 1);

  const colonIndex = credentials.indexOf(':');  // first : separates user from password
  const username = credentials.substring(0, colonIndex);
  const password = credentials.substring(colonIndex + 1);

  const [hostPort, ...dbParts] = hostPart.split('/');
  const [host, portStr] = hostPort.split(':');
  const port = parseInt(portStr || '5432', 10);
  const database = (dbParts.join('/') || 'postgres').split('?')[0] || 'postgres';

  logger.info(`DB Config: host=${host}, port=${port}, db=${database}, user=${username}, pass_length=${password.length}`);

  sequelize = new Sequelize(database, username, password, {
    ...commonOptions,
    host,
    port,
  });
} else {
  logger.warn('DB: No valid DATABASE_URL, using individual env vars or defaults');
  sequelize = new Sequelize(
    process.env.DB_NAME || 'leadforge_db',
    process.env.DB_USER || 'postgres',
    process.env.DB_PASSWORD || 'postgres',
    {
      ...commonOptions,
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
    }
  );
}

module.exports = sequelize;
