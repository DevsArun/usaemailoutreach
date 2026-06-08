const { callGroq } = require('../config/groq');
const logger = require('../utils/logger');

// Signature used to sign every outreach email.
const SENDER_NAME = process.env.OUTREACH_SENDER_NAME || 'DevsArun';
const SENDER_TITLE = process.env.OUTREACH_SENDER_TITLE || 'Full Stack Developer';

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
      content: `You are ${SENDER_NAME}, a professional ${SENDER_TITLE}. Write a personalized cold outreach email to a local business owner that reads like a thoughtful human wrote it AFTER actually researching their business.

FORMATTING IS CRITICAL. The "body" MUST use real line breaks and be split into short sections separated by a blank line. Follow this EXACT structure (keep the blank lines):

Hi <OwnerFirstName>, (or "Hi there," if no name)

<Paragraph 1: 1-2 sentences referencing something specific and genuine about THEIR business — their Google rating and what customers praise in the reviews.>

<Paragraph 2: 1-2 sentences naming a concrete gap you noticed from their reviews or website, and why it quietly costs them customers.>

<Paragraph 3: 1-2 sentences proposing ONE specific thing you can build for them and the real outcome it delivers (more booked jobs, fewer missed enquiries, more reviews).>

<One short line: a direct, friendly question asking if they're interested — e.g. "If this sounds useful, can I send a quick 1-minute demo?">

Best regards,
${SENDER_NAME}
${SENDER_TITLE}

STYLE: warm, professional, confident, specific to THIS business. 110-170 words. Natural human tone. NO "I hope this finds you well", NO buzzwords, NO pricing, NO links, NO bullet points.

Return ONLY valid JSON: {"subject":"...","body":"..."} — and inside the body string use \\n for line breaks and \\n\\n between paragraphs. The subject must be specific to the business (not generic).`,
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
    const response = await callGroq(prompt, { temperature: 0.8, maxTokens: 1024 });
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No valid JSON in response');

    let result;
    try {
      result = JSON.parse(jsonMatch[0]);
    } catch (e) {
      // Models often emit literal newlines inside the JSON string (invalid
      // JSON). Extract the fields manually and unescape.
      const subj = jsonMatch[0].match(/"subject"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      const bod = jsonMatch[0].match(/"body"\s*:\s*"([\s\S]*?)"\s*\}\s*$/);
      if (!subj || !bod) throw e;
      result = {
        subject: subj[1].replace(/\\"/g, '"'),
        body: bod[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
      };
    }
    if (!result.subject || !result.body) throw new Error('AI response missing subject/body');

    let body = result.body.trim();

    // ── Normalize formatting so the email always reads cleanly ──
    // 1) Greeting on its own line (with a blank line after it).
    body = body.replace(/^(hi\b[^,\n]{0,40},|hello\b[^,\n]{0,40},|hey\b[^,\n]{0,40},)[ \t]+/i, '$1\n\n');
    // 2) Replace any trailing sign-off the model added with a clean signature block.
    const signoffRe = /(best\s+regards|warm\s+regards|kind\s+regards|regards|sincerely|cheers|thanks|thank\s+you)\b/gi;
    let lastIdx = -1, mm;
    while ((mm = signoffRe.exec(body)) !== null) lastIdx = mm.index;
    if (lastIdx !== -1 && lastIdx >= body.length - 110) {
      body = body.slice(0, lastIdx).trim();
    }
    body = `${body}\n\nBest regards,\n${SENDER_NAME}\n${SENDER_TITLE}`;
    // 3) Collapse any 3+ consecutive newlines down to a clean paragraph break.
    body = body.replace(/\n{3,}/g, '\n\n');

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
