const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const User = sequelize.define('users', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
    validate: { isEmail: true },
  },
  password_hash: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  last_login: {
    type: DataTypes.DATE,
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
});

const Campaign = sequelize.define('campaigns', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },
  query: {
    type: DataTypes.STRING(500),
    allowNull: false,
  },
  keyword: {
    type: DataTypes.STRING(255),
  },
  location: {
    type: DataTypes.STRING(255),
  },
  status: {
    type: DataTypes.ENUM('pending', 'running', 'paused', 'stopped', 'completed', 'failed'),
    defaultValue: 'pending',
  },
  settings: {
    type: DataTypes.JSONB,
    defaultValue: {
      sources: ['google_maps'],
      max_results: 100,
      scrape_reviews: true,
      crawl_websites: true,
      find_emails: true,
      verify_emails: true,
      generate_outreach: true,
      daily_email_limit: 50,
    },
  },
  progress: {
    type: DataTypes.JSONB,
    defaultValue: {
      businesses_found: 0,
      reviews_collected: 0,
      websites_crawled: 0,
      emails_found: 0,
      emails_verified: 0,
      outreach_generated: 0,
      emails_sent: 0,
      current_stage: 'idle',
    },
  },
  started_at: { type: DataTypes.DATE },
  completed_at: { type: DataTypes.DATE },
  error_message: { type: DataTypes.TEXT },
});

const Business = sequelize.define('businesses', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  campaign_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'campaigns', key: 'id' },
  },
  name: {
    type: DataTypes.STRING(500),
    allowNull: false,
  },
  address: { type: DataTypes.TEXT },
  phone: { type: DataTypes.STRING(50) },
  website: { type: DataTypes.STRING(500) },
  rating: { type: DataTypes.FLOAT },
  reviews_count: { type: DataTypes.INTEGER, defaultValue: 0 },
  category: { type: DataTypes.STRING(255) },
  opening_hours: { type: DataTypes.JSONB },
  owner_name: { type: DataTypes.STRING(255) },
  social_links: {
    type: DataTypes.JSONB,
    defaultValue: {},
  },
  source: { type: DataTypes.STRING(50) },
  latitude: { type: DataTypes.FLOAT },
  longitude: { type: DataTypes.FLOAT },
  lead_score: { type: DataTypes.INTEGER, defaultValue: 0 },
  ai_analysis: { type: DataTypes.JSONB },
  recommended_services: { type: DataTypes.JSONB, defaultValue: [] },
  pain_points: { type: DataTypes.JSONB, defaultValue: [] },
  pipeline_stage: {
    type: DataTypes.ENUM(
      'discovered', 'analyzed', 'email_sent', 'opened',
      'replied', 'interested', 'meeting_scheduled',
      'proposal_sent', 'won', 'lost'
    ),
    defaultValue: 'discovered',
  },
  pipeline_notes: { type: DataTypes.TEXT },
  pipeline_updated_at: { type: DataTypes.DATE },
});

const Review = sequelize.define('reviews', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  business_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'businesses', key: 'id' },
  },
  reviewer_name: { type: DataTypes.STRING(255) },
  rating: { type: DataTypes.INTEGER },
  text: { type: DataTypes.TEXT },
  review_date: { type: DataTypes.STRING(100) },
  source: { type: DataTypes.STRING(50), defaultValue: 'google_maps' },
  sentiment: { type: DataTypes.ENUM('positive', 'neutral', 'negative') },
  key_issues: { type: DataTypes.JSONB, defaultValue: [] },
});

const WebsiteAnalysis = sequelize.define('website_analyses', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  business_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true,
    references: { model: 'businesses', key: 'id' },
  },
  url: { type: DataTypes.STRING(500) },
  title: { type: DataTypes.STRING(500) },
  meta_description: { type: DataTypes.TEXT },
  services: { type: DataTypes.JSONB, defaultValue: [] },
  contact_info: { type: DataTypes.JSONB, defaultValue: {} },
  pages_crawled: { type: DataTypes.INTEGER, defaultValue: 0 },
  mobile_friendly: { type: DataTypes.BOOLEAN },
  ssl: { type: DataTypes.BOOLEAN },
  page_speed: { type: DataTypes.INTEGER },
  broken_links: { type: DataTypes.JSONB, defaultValue: [] },
  has_chatbot: { type: DataTypes.BOOLEAN, defaultValue: false },
  has_whatsapp: { type: DataTypes.BOOLEAN, defaultValue: false },
  has_crm: { type: DataTypes.BOOLEAN, defaultValue: false },
  has_booking: { type: DataTypes.BOOLEAN, defaultValue: false },
  has_reviews_widget: { type: DataTypes.BOOLEAN, defaultValue: false },
  has_automation: { type: DataTypes.BOOLEAN, defaultValue: false },
  has_lead_capture: { type: DataTypes.BOOLEAN, defaultValue: false },
  has_live_chat: { type: DataTypes.BOOLEAN, defaultValue: false },
  tech_stack: { type: DataTypes.JSONB, defaultValue: [] },
  forms: { type: DataTypes.JSONB, defaultValue: [] },
  raw_data: { type: DataTypes.JSONB },
});

const Email = sequelize.define('emails', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  business_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'businesses', key: 'id' },
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  type: {
    type: DataTypes.ENUM('owner', 'marketing', 'support', 'general'),
    defaultValue: 'general',
  },
  source: { type: DataTypes.STRING(255) },
  verification_status: {
    type: DataTypes.ENUM('pending', 'valid', 'risky', 'invalid', 'catch_all'),
    defaultValue: 'pending',
  },
  verification_details: { type: DataTypes.JSONB },
  verified_at: { type: DataTypes.DATE },
  is_primary: { type: DataTypes.BOOLEAN, defaultValue: false },
});

const OutreachEmail = sequelize.define('outreach_emails', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  business_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'businesses', key: 'id' },
  },
  campaign_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'campaigns', key: 'id' },
  },
  email_id: {
    type: DataTypes.INTEGER,
    references: { model: 'emails', key: 'id' },
  },
  to_email: { type: DataTypes.STRING(255), allowNull: false },
  from_email: { type: DataTypes.STRING(255) },
  subject: { type: DataTypes.STRING(500), allowNull: false },
  body: { type: DataTypes.TEXT, allowNull: false },
  status: {
    type: DataTypes.ENUM('draft', 'approved', 'rejected', 'queued', 'sent', 'delivered', 'bounced', 'opened', 'replied', 'failed'),
    defaultValue: 'draft',
  },
  smtp_account_id: { type: DataTypes.INTEGER },
  sent_at: { type: DataTypes.DATE },
  delivered_at: { type: DataTypes.DATE },
  opened_at: { type: DataTypes.DATE },
  replied_at: { type: DataTypes.DATE },
  reply_text: { type: DataTypes.TEXT },
  reply_classification: {
    type: DataTypes.ENUM('interested', 'send_pricing', 'call_me', 'already_have', 'not_interested', 'unsubscribe', 'other'),
  },
  ai_context: { type: DataTypes.JSONB },
  error_message: { type: DataTypes.TEXT },
  sequence_number: { type: DataTypes.INTEGER, defaultValue: 1 },
});

const Followup = sequelize.define('followups', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  outreach_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'outreach_emails', key: 'id' },
  },
  sequence_number: { type: DataTypes.INTEGER, allowNull: false },
  subject: { type: DataTypes.STRING(500) },
  body: { type: DataTypes.TEXT, allowNull: false },
  status: {
    type: DataTypes.ENUM('draft', 'approved', 'queued', 'sent', 'delivered', 'opened', 'replied', 'failed'),
    defaultValue: 'draft',
  },
  scheduled_at: { type: DataTypes.DATE },
  sent_at: { type: DataTypes.DATE },
  opened_at: { type: DataTypes.DATE },
  replied_at: { type: DataTypes.DATE },
});

const SmtpAccount = sequelize.define('smtp_accounts', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },
  provider: {
    type: DataTypes.ENUM('gmail', 'outlook', 'custom'),
    allowNull: false,
  },
  email: { type: DataTypes.STRING(255), allowNull: false },
  password: { type: DataTypes.STRING(500), allowNull: false },
  host: { type: DataTypes.STRING(255) },
  port: { type: DataTypes.INTEGER },
  secure: { type: DataTypes.BOOLEAN, defaultValue: true },
  daily_limit: { type: DataTypes.INTEGER, defaultValue: 500 },
  sent_today: { type: DataTypes.INTEGER, defaultValue: 0 },
  last_reset: { type: DataTypes.DATEONLY, defaultValue: DataTypes.NOW },
  status: {
    type: DataTypes.ENUM('active', 'inactive', 'error'),
    defaultValue: 'active',
  },
  error_message: { type: DataTypes.TEXT },
});

const GroqKey = sequelize.define('groq_keys', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },
  api_key: {
    type: DataTypes.STRING(500),
    allowNull: false,
  },
  label: { type: DataTypes.STRING(100) },
  usage_count: { type: DataTypes.INTEGER, defaultValue: 0 },
  last_used: { type: DataTypes.DATE },
  status: {
    type: DataTypes.ENUM('active', 'inactive', 'rate_limited', 'invalid'),
    defaultValue: 'active',
  },
});

const AnalyticsEvent = sequelize.define('analytics_events', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  campaign_id: {
    type: DataTypes.INTEGER,
    references: { model: 'campaigns', key: 'id' },
  },
  event_type: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  metadata: { type: DataTypes.JSONB, defaultValue: {} },
  timestamp: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
});

const Setting = sequelize.define('settings', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },
  key: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  value: {
    type: DataTypes.JSONB,
  },
}, {
  indexes: [
    { unique: true, fields: ['user_id', 'key'] },
  ],
});

User.hasMany(Campaign, { foreignKey: 'user_id', as: 'campaigns' });
Campaign.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

Campaign.hasMany(Business, { foreignKey: 'campaign_id', as: 'businesses' });
Business.belongsTo(Campaign, { foreignKey: 'campaign_id', as: 'campaign' });

Business.hasMany(Review, { foreignKey: 'business_id', as: 'reviews' });
Review.belongsTo(Business, { foreignKey: 'business_id', as: 'business' });

Business.hasOne(WebsiteAnalysis, { foreignKey: 'business_id', as: 'website_analysis' });
WebsiteAnalysis.belongsTo(Business, { foreignKey: 'business_id', as: 'business' });

Business.hasMany(Email, { foreignKey: 'business_id', as: 'emails' });
Email.belongsTo(Business, { foreignKey: 'business_id', as: 'business' });

Business.hasMany(OutreachEmail, { foreignKey: 'business_id', as: 'outreach_emails' });
OutreachEmail.belongsTo(Business, { foreignKey: 'business_id', as: 'business' });

Campaign.hasMany(OutreachEmail, { foreignKey: 'campaign_id', as: 'outreach_emails' });
OutreachEmail.belongsTo(Campaign, { foreignKey: 'campaign_id', as: 'campaign' });

OutreachEmail.belongsTo(Email, { foreignKey: 'email_id', as: 'email' });
Email.hasMany(OutreachEmail, { foreignKey: 'email_id', as: 'outreach_emails' });

OutreachEmail.hasMany(Followup, { foreignKey: 'outreach_id', as: 'followups' });
Followup.belongsTo(OutreachEmail, { foreignKey: 'outreach_id', as: 'outreach' });

User.hasMany(SmtpAccount, { foreignKey: 'user_id', as: 'smtp_accounts' });
SmtpAccount.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

User.hasMany(GroqKey, { foreignKey: 'user_id', as: 'groq_keys' });
GroqKey.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

Campaign.hasMany(AnalyticsEvent, { foreignKey: 'campaign_id', as: 'analytics_events' });
AnalyticsEvent.belongsTo(Campaign, { foreignKey: 'campaign_id', as: 'campaign' });

User.hasMany(Setting, { foreignKey: 'user_id', as: 'settings' });
Setting.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

module.exports = {
  sequelize,
  User,
  Campaign,
  Business,
  Review,
  WebsiteAnalysis,
  Email,
  OutreachEmail,
  Followup,
  SmtpAccount,
  GroqKey,
  AnalyticsEvent,
  Setting,
};
