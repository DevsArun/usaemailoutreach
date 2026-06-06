const { callGroq } = require('../config/groq');
const logger = require('../utils/logger');

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
  const topPainPoints = (aiAnalysis.pain_points || [])
    .filter(p => p.severity === 'high')
    .slice(0, 3)
    .map(p => p.issue);

  const topServices = (aiAnalysis.recommended_services || [])
    .slice(0, 2)
    .map(s => s.service);

  const reviewComplaints = reviews
    .filter(r => r.rating <= 3)
    .slice(0, 3)
    .map(r => r.text)
    .filter(Boolean);

  const prompt = [
    {
      role: 'system',
      content: `You are a professional business outreach specialist. Write a cold email that:
- Is highly personalized based on the business's specific problems
- References specific review complaints or website issues naturally
- Proposes a solution without being salesy
- Is brief (under 120 words)
- Uses the business owner's first name if available, otherwise use a professional greeting
- Does NOT include portfolio links
- Does NOT mention "I am a web developer" or similar
- Does NOT dump services list
- Focuses entirely on the business's problem and a solution
- Ends with a soft call to action (question, not demand)
- Has a natural, human tone

Return ONLY a JSON object with "subject" and "body" fields. No other text.`,
    },
    {
      role: 'user',
      content: `Business: ${business.name}
Owner: ${business.owner_name || 'Business Owner'}
Category: ${business.category || 'Local Business'}
Location: ${business.address || ''}
Rating: ${business.rating || 'N/A'}

Key Pain Points:
${topPainPoints.join('\n') || 'General business improvement opportunities'}

Customer Complaints from Reviews:
${reviewComplaints.join('\n') || 'No specific complaints found'}

Recommended Solutions:
${topServices.join(', ') || 'Business automation and optimization'}

Email Angle: ${aiAnalysis.email_angle || 'Focus on improving business efficiency'}`,
    },
  ];

  try {
    const response = await callGroq(prompt, { temperature: 0.8, maxTokens: 1024 });
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return {
        subject: result.subject,
        body: result.body,
      };
    }
    throw new Error('No valid JSON in response');
  } catch (error) {
    logger.error('Email generation failed:', error.message);
    return {
      subject: `Quick idea for ${business.name}`,
      body: `Hi,\n\nI noticed some opportunities to improve how ${business.name} captures and manages incoming leads online.\n\nWould you be open to hearing a quick idea?\n\nBest regards`,
    };
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
