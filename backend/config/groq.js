const { Groq } = require('groq-sdk');
const logger = require('../utils/logger');

class GroqKeyManager {
  constructor() {
    this.keys = [];
    this.currentIndex = 0;
    this.cooldowns = new Map();
    this.usageCounts = new Map();
    this.loadKeysFromEnv();
  }

  loadKeysFromEnv() {
    for (let i = 1; i <= 5; i++) {
      const key = process.env[`GROQ_API_KEY_${i}`];
      if (key && key !== `gsk_your_key_${i}` && key.startsWith('gsk_')) {
        this.keys.push(key);
        this.usageCounts.set(key, 0);
      }
    }
    if (this.keys.length === 0) {
      logger.warn('No valid Groq API keys found in environment variables.');
    } else {
      logger.info(`Loaded ${this.keys.length} Groq API key(s).`);
    }
  }

  addKey(apiKey) {
    if (!this.keys.includes(apiKey)) {
      this.keys.push(apiKey);
      this.usageCounts.set(apiKey, 0);
      logger.info(`Added Groq API key. Total keys: ${this.keys.length}`);
    }
  }

  removeKey(apiKey) {
    this.keys = this.keys.filter(k => k !== apiKey);
    this.cooldowns.delete(apiKey);
    this.usageCounts.delete(apiKey);
  }

  getClient() {
    if (this.keys.length === 0) {
      throw new Error('No Groq API keys available. Add keys in Settings.');
    }

    const now = Date.now();
    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this.currentIndex + i) % this.keys.length;
      const key = this.keys[idx];
      const cooldownEnd = this.cooldowns.get(key) || 0;

      if (now > cooldownEnd) {
        this.currentIndex = (idx + 1) % this.keys.length;
        this.usageCounts.set(key, (this.usageCounts.get(key) || 0) + 1);
        return {
          client: new Groq({ apiKey: key }),
          keyIndex: idx,
          key: key,
        };
      }
    }

    const shortestCooldown = Math.min(...Array.from(this.cooldowns.values())) - now;
    throw new Error(`All Groq API keys on cooldown. Shortest wait: ${Math.ceil(shortestCooldown / 1000)}s`);
  }

  markCooldown(key, durationMs = 60000) {
    this.cooldowns.set(key, Date.now() + durationMs);
    logger.warn(`Groq key ${key.substring(0, 10)}... on cooldown for ${durationMs / 1000}s`);
  }

  getStatus() {
    const now = Date.now();
    return this.keys.map((key, idx) => ({
      index: idx,
      keyPreview: key.substring(0, 10) + '...' + key.substring(key.length - 4),
      usageCount: this.usageCounts.get(key) || 0,
      onCooldown: now < (this.cooldowns.get(key) || 0),
      cooldownRemaining: Math.max(0, (this.cooldowns.get(key) || 0) - now),
    }));
  }

  get keyCount() {
    return this.keys.length;
  }
}

const groqKeyManager = new GroqKeyManager();

async function callGroq(messages, options = {}) {
  const model = options.model || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  const maxTokens = options.maxTokens || 4096;
  const temperature = options.temperature || 0.7;
  const maxRetries = options.maxRetries || 3;

  let lastError = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const { client, key } = groqKeyManager.getClient();
      const completion = await client.chat.completions.create({
        messages,
        model,
        max_tokens: maxTokens,
        temperature,
      });
      return completion.choices[0].message.content;
    } catch (error) {
      lastError = error;
      if (error.status === 429) {
        const retryAfter = parseInt(error.headers?.['retry-after'] || '60', 10);
        groqKeyManager.markCooldown(
          groqKeyManager.keys[groqKeyManager.currentIndex === 0 ? groqKeyManager.keys.length - 1 : groqKeyManager.currentIndex - 1],
          retryAfter * 1000
        );
        logger.warn(`Groq rate limited. Attempt ${attempt + 1}/${maxRetries}. Retrying...`);
        continue;
      }
      logger.error('Groq API error:', error.message);
      throw error;
    }
  }
  throw lastError;
}

module.exports = { groqKeyManager, callGroq };
