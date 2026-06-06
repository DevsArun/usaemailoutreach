const { v4: uuidv4 } = require('uuid');

function generateId() {
  return uuidv4();
}

function sanitizeEmail(email) {
  return email ? email.toLowerCase().trim() : null;
}

function parseSearchQuery(query) {
  const parts = query.match(/^(.+?)\s+in\s+(.+)$/i);
  if (parts) {
    return {
      keyword: parts[1].trim(),
      location: parts[2].trim(),
    };
  }
  return {
    keyword: query.trim(),
    location: '',
  };
}

function calculateLeadScore(business, websiteAnalysis, reviewAnalysis) {
  let score = 50;

  if (!business.website) score -= 15;
  if (business.rating && business.rating < 3.5) score += 10;
  if (business.reviews_count && business.reviews_count < 50) score += 5;

  if (websiteAnalysis) {
    if (!websiteAnalysis.has_chatbot) score += 8;
    if (!websiteAnalysis.has_whatsapp) score += 8;
    if (!websiteAnalysis.has_crm) score += 10;
    if (!websiteAnalysis.has_booking) score += 8;
    if (!websiteAnalysis.has_lead_capture) score += 8;
    if (!websiteAnalysis.has_reviews_widget) score += 5;
    if (!websiteAnalysis.mobile_friendly) score += 5;
    if (!websiteAnalysis.ssl) score += 3;
    if (websiteAnalysis.page_speed && websiteAnalysis.page_speed < 50) score += 5;
  } else {
    score += 20;
  }

  if (reviewAnalysis) {
    if (reviewAnalysis.negative_sentiment_ratio > 0.3) score += 10;
    if (reviewAnalysis.common_complaints && reviewAnalysis.common_complaints.length > 2) score += 5;
  }

  return Math.min(100, Math.max(0, score));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function truncateText(text, maxLength = 200) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

function formatDate(date) {
  return new Date(date).toISOString().split('T')[0];
}

function paginateResults(query, page = 1, limit = 50) {
  const offset = (page - 1) * limit;
  return {
    ...query,
    limit,
    offset,
  };
}

function buildPaginationMeta(totalCount, page, limit) {
  return {
    total: totalCount,
    page,
    limit,
    totalPages: Math.ceil(totalCount / limit),
    hasNext: page * limit < totalCount,
    hasPrev: page > 1,
  };
}

module.exports = {
  generateId,
  sanitizeEmail,
  parseSearchQuery,
  calculateLeadScore,
  sleep,
  truncateText,
  formatDate,
  paginateResults,
  buildPaginationMeta,
};
