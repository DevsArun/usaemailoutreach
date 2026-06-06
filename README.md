---
title: LeadForge AI
emoji: 🚀
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: true
---

# LeadForge AI — Business Intelligence & Outreach Platform

AI-powered platform for discovering businesses, analyzing their digital presence, and generating personalized outreach campaigns.

## Features

- 🔍 Multi-source business discovery (Google Maps, Yelp, YellowPages, BBB, Bing, Facebook)
- 📊 AI-powered business analysis with Groq LLM
- 🌐 Website intelligence crawler
- ✉️ Personalized AI-generated outreach emails
- 📧 SMTP email delivery with rate limiting
- 🔄 Automated follow-up sequences
- 📈 Real-time analytics dashboard
- 🎯 Lead scoring and prioritization
- 📋 Sales pipeline (Kanban board)
- 💬 Reply center with AI classification

## Environment Variables

Set these in the HuggingFace Space settings:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `JWT_SECRET` | Yes | Secret key for JWT tokens |
| `GROQ_API_KEY_1` | Yes | Groq API key (at least one) |
| `GROQ_API_KEY_2-5` | No | Additional Groq keys for rotation |

## Quick Start

```bash
# Clone the repository
git clone <repo-url>
cd leadforge-ai

# Copy environment file
cp .env.example .env
# Edit .env with your settings

# Start with Docker
docker compose up -d

# Access at http://localhost:7860
```
