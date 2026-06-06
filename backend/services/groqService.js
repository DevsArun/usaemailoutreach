const { callGroq } = require('../config/groq');
const logger = require('../utils/logger');

// Signature name used to sign every outreach email.
const SENDER_NAME = process.env.OUTREACH_SENDER_NAME || 'DevsArun';

const SERVICE_CATALOG = {
  website_dev: { name: 'Website Development', keywords: ['no website', 'poor website', 'outdated'] },
  website_redesign: { name: 'Website Redesign', keywords: ['slow', 'not mobile friendly', 'poor design'] },
  crm_dev: { name: 'CRM Development', keywords: ['no crm', 'lead tracking', 'customer management'] },
  whatsapp_automation: { name: 'WhatsApp Automation', keywords: ['no whatsapp', 'response delay', 'missed calls'] },
  ai_agents: { name: 'AI Agents', keywords: ['automation', 'ai', 'intelligent'] },
  chatbots: { name: 'Chatbots', keywords: ['no chatbot', 'customer support', 'response time'] },
  review_mgmt: { name: 'Review Management', keywords: ['bad reviews', 'reputation', 'negative feedback'] },
  lead_mgmt: { name: 'Lead Management', keywords: ['lead leakage', 'missed leads', 'no follow-up'] },
  booking_system: { name: 'Booking System', keywords: ['no booking', 'appointment', 'scheduling'] },
  mobile_app: { name: 'Mobile App', keywords: ['mobile app', 'ios', 'android'] },
  api_integration: { name: 'API Integration', keywords: ['integration', 'connect', 'automate'] },
};

async function analyzeBusinessWithAI(business, reviews, websiteAnalysis) {
  const reviewsSummary = reviews.map(r =>
    `${r.reviewer_name || 'Anonymous'} - ${r.rating} stars: "${r.text || 'No text'}"`
  ).join('\n');

  const websiteIssues = [];
  if (websiteAnalysis) {
    if (!websiteAnalysis.has_chatbot) websiteIssues.push('No Chatbot');
    if (!websiteAnalysis.has_whatsapp) websiteIssues.push('No WhatsApp Integration');
    if (!websiteAnalysis.has_crm) websiteIssues.push('No CRM Detected');
    if (!websiteAnalysis.has_booking) websiteIssues.push('No Booking System');
    if (!websiteAnalysis.has_lead_capture) websiteIssues.push('No Lead Capture Forms');
    if (!websiteAnalysis.has_reviews_widget) websiteIssues.push('No Reviews Widget');
    if (!websiteAnalysis.has_live_chat) websiteIssues.push('No Live Chat');
    if (websiteAnalysis.mobile_friendly === false) websiteIssues.push('Not Mobile Friendly');
    if (!websiteAnalysis.ssl) websiteIssues.push('No SSL Certificate');
    if (websiteAnalysis.page_speed && websiteAnalysis.page_speed < 50) websiteIssues.push('Slow Page Speed');
  } else {
    websiteIssues.push('No Website or Website Not Accessible');
  }

  const prompt = [
    {
      role: 'system',
      content: `You are a business intelligence analyst. Analyze the following business data and provide a structured assessment.

You MUST respond with valid JSON only, no additional text. Use this exact structure:
{
  "business_score": <number 0-100>,
  "pain_points": [{"issue": "<description>", "severity": "<high|medium|low>"}],
  "recommended_services": [{"service": "<service name>", "reason": "<why this service would help>", "expected_impact": "<description of expected improvement>"}],
  "revenue_potential": "<low|medium|high>",
  "response_probability": "<low|medium|high>",
  "website_quality": "<poor|fair|good|excellent>",
  "automation_opportunity": "<low|medium|high>",
  "key_insight": "<one-sentence summary of the biggest opportunity>",
  "email_angle": "<suggested email approach in one sentence>"
}`,
    },
    {
      role: 'user',
      content: `Business: ${business.name}
Category: ${business.category || 'Unknown'}
Location: ${business.address || 'Unknown'}
Rating: ${business.rating || 'N/A'} (${business.reviews_count || 0} reviews)
Website: ${business.website || 'None'}

Website Issues Found:
${websiteIssues.join('\n') || 'None detected'}

Recent Customer Reviews:
${reviewsSummary || 'No reviews available'}`,
    },
  ];

  try {
    const response = await callGroq(prompt, { temperature: 0.5, maxTokens: 2048 });
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('No valid JSON in response');
  } catch (error) {
    logger.error('AI analysis failed:', error.message);
    return {
      business_score: 50,
      pain_points: websiteIssues.map(issue => ({ issue, severity: 'medium' })),
      recommended_services: [],
      revenue_potential: 'medium',
      response_probability: 'medium',
      website_quality: websiteAnalysis ? 'fair' : 'poor',
      automation_opportunity: websiteIssues.length > 3 ? 'high' : 'medium',
      key_insight: 'Analysis could not be completed. Manual review recommended.',
      email_angle: 'Focus on business improvement opportunities.',
    };
  }
}

async function generateOutreachEmail(business, reviews, websiteAnalysis, aiAnalysis) {
  // ── Build rich, business-specific context for maximum personalization ──
  const websiteFindings = [];
  if (websiteAnalysis && websiteAnalysis.url) {
    if (!websiteAnalysis.has_booking) websiteFindings.push('no online booking/appointment system');
    if (!websiteAnalysis.has_whatsapp) websiteFindings.push('no WhatsApp contact option');
    if (!websiteAnalysis.has_chatbot && !websiteAnalysis.has_live_chat) websiteFindings.push('no live chat / chatbot');
    if (!websiteAnalysis.has_crm) websiteFindings.push('no visible lead-capture/CRM');
    if (!websiteAnalysis.has_lead_capture) websiteFindings.push('no lead-capture form');
    if (websiteAnalysis.mobile_friendly === false) websiteFindings.push('website is not mobile-friendly');
    if (websiteAnalysis.ssl === false) websiteFindings.push('no SSL/secure connection');
    if (websiteAnalysis.page_speed && websiteAnalysis.page_speed < 50) websiteFindings.push('slow page-load speed');
  } else {
    websiteFindings.push('no website found online (huge missed-opportunity for a business this size)');
  }

  const complaintQuotes = (reviews || [])
    .filter(r => r.text && r.rating && r.rating <= 3)
    .slice(0, 4)
    .map(r => `- (${r.rating}★) "${r.text.slice(0, 220)}"`);
  const praiseQuotes = (reviews || [])
    .filter(r => r.text && r.rating && r.rating >= 4)
    .slice(0, 2)
    .map(r => `- (${r.rating}★) "${r.text.slice(0, 160)}"`);

  const painPoints = (aiAnalysis.pain_points || [])
    .map(p => (p && (p.issue || p)) || '')
    .filter(Boolean)
    .slice(0, 4)
    .join('; ');

  const services = (aiAnalysis.recommended_services || [])
    .map(s => (s && (s.service || s)) || '')
    .filter(Boolean)
    .slice(0, 2)
    .join(' and ');

  const prompt = [
    {
      role: 'system',
      content: `You are ${SENDER_NAME}, an independent web & automation specialist writing a one-to-one cold email to a local business owner.

Write a HIGHLY PERSONALIZED email that proves you actually researched THIS specific business. Rules:
- Open by referencing something concrete about the business (its name, what customers say in reviews, or a specific gap on their website).
- Naturally weave in 1-2 real issues (from reviews or the website findings) — do NOT list them like a report.
- Propose ONE clear, relevant improvement and the outcome it drives (more booked jobs, fewer missed calls, more reviews).
- Under 130 words. Warm, human, confident — not salesy, no buzzwords, no "I hope this finds you well".
- Use the owner's first name if provided, else a natural greeting (e.g. "Hi there,").
- NO portfolio links, NO pricing, NO bullet lists, NO "I am a web developer" intro.
- End with a soft question as the call to action.
- The email body MUST end with EXACTLY these two lines:
Best regards,
${SENDER_NAME}

Return ONLY a JSON object: {"subject": "...", "body": "..."} with no other text. The subject must be specific to the business (not generic).`,
    },
    {
      role: 'user',
      content: `BUSINESS: ${business.name}
Owner: ${business.owner_name || '(unknown — use a natural greeting)'}
Category: ${business.category || 'local business'}
Location: ${business.address || ''}
Google rating: ${business.rating || 'N/A'} from ${business.reviews_count || 0} reviews
Website: ${business.website || 'NONE'}

WEBSITE / DIGITAL GAPS:
${websiteFindings.map(f => '- ' + f).join('\n')}

WHAT UNHAPPY CUSTOMERS SAY (use these to personalize, paraphrase — don't quote verbatim in full):
${complaintQuotes.join('\n') || '(no negative reviews available)'}

WHAT HAPPY CUSTOMERS SAY:
${praiseQuotes.join('\n') || '(none)'}

AI-IDENTIFIED PAIN POINTS: ${painPoints || 'general growth opportunities'}
BEST-FIT SOLUTION TO PITCH: ${services || 'a tailored website/automation improvement'}
KEY ANGLE: ${aiAnalysis.email_angle || 'help them capture and convert more local leads'}`,
    },
  ];

  try {
    const response = await callGroq(prompt, { temperature: 0.85, maxTokens: 1024 });
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No valid JSON in response');

    const result = JSON.parse(jsonMatch[0]);
    if (!result.subject || !result.body) throw new Error('AI response missing subject/body');

    let body = result.body.trim();
    // Guarantee the required signature.
    if (!new RegExp(SENDER_NAME, 'i').test(body)) {
      body = `${body}\n\nBest regards,\n${SENDER_NAME}`;
    }

    return { subject: result.subject.trim(), body };
  } catch (error) {
    // No generic fallback: if AI is unavailable (e.g. no Groq key) we do NOT
    // create a templated email. The caller will skip creating a draft so that
    // every saved outreach email is genuinely AI-personalized.
    logger.warn(`Outreach generation skipped — AI unavailable: ${error.message}`);
    return null;
  }
}

async function classifyReply(originalSubject, replyText) {
  const prompt = [
    {
      role: 'system',
      content: `Classify this email reply into one category. Reply with ONLY the category name:
- interested
- send_pricing
- call_me
- already_have
- not_interested
- unsubscribe
- other`,
    },
    {
      role: 'user',
      content: `Subject: ${originalSubject}\nReply: ${replyText}`,
    },
  ];

  try {
    const response = await callGroq(prompt, { maxTokens: 20, temperature: 0.1 });
    const category = response.trim().toLowerCase().replace(/[^a-z_]/g, '');
    const valid = ['interested', 'send_pricing', 'call_me', 'already_have', 'not_interested', 'unsubscribe', 'other'];
    return valid.includes(category) ? category : 'other';
  } catch (error) {
    logger.error('Reply classification failed:', error.message);
    return 'other';
  }
}

async function matchServices(websiteAnalysis, painPoints) {
  const matched = [];

  if (!websiteAnalysis || !websiteAnalysis.url) {
    matched.push(SERVICE_CATALOG.website_dev);
  }

  if (websiteAnalysis) {
    if (!websiteAnalysis.has_booking) matched.push(SERVICE_CATALOG.booking_system);
    if (!websiteAnalysis.has_chatbot) matched.push(SERVICE_CATALOG.chatbots);
    if (!websiteAnalysis.has_whatsapp) matched.push(SERVICE_CATALOG.whatsapp_automation);
    if (!websiteAnalysis.has_crm) matched.push(SERVICE_CATALOG.crm_dev);
    if (!websiteAnalysis.has_lead_capture) matched.push(SERVICE_CATALOG.lead_mgmt);
    if (!websiteAnalysis.mobile_friendly || websiteAnalysis.page_speed < 50) {
      matched.push(SERVICE_CATALOG.website_redesign);
    }
  }

  const painPointText = (painPoints || []).map(p => p.issue || p).join(' ').toLowerCase();
  for (const [key, service] of Object.entries(SERVICE_CATALOG)) {
    if (!matched.find(m => m.name === service.name)) {
      if (service.keywords.some(kw => painPointText.includes(kw))) {
        matched.push(service);
      }
    }
  }

  return matched.slice(0, 5).map(s => s.name);
}

module.exports = {
  analyzeBusinessWithAI,
  generateOutreachEmail,
  classifyReply,
  matchServices,
};
